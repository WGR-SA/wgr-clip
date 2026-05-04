import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { loadSettings, saveSettings } from '~/composables/useSettingsStore'
import type {
  AppInfo,
  CustomParams,
  Job,
  JobCancelledEvent,
  JobDoneEvent,
  JobErrorEvent,
  MediaKind,
  Preset,
  ProgressTick
} from '~/types/job'

export const DEFAULT_CUSTOM: CustomParams = {
  video_max_height: 1080,
  video_crf: 22,
  video_audio_kbps: 128,
  image_max_dim: 2000,
  image_quality: 85,
  audio_kbps: 192
}

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mts', 'm2ts', 'ts', '3gp']
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif']

function detectKind (path: string): MediaKind {
  const m = path.toLowerCase().match(/\.([^./\\]+)$/)
  const ext = (m && m[1]) ? m[1] : ''
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  return 'video'
}

interface QueueState {
  jobs: Map<string, Job>
  videoPreset: Preset
  imagePreset: Preset
  audioPreset: Preset
  custom: CustomParams
  outputDir: string | null
  appInfo: AppInfo | null
  listenersBound: boolean
  unlisteners: UnlistenFn[]
}

function makeJob (id: string, input: string, output: string, preset: Preset, kind?: MediaKind, custom?: CustomParams | null): Job {
  return {
    id,
    input,
    output,
    preset,
    kind: kind ?? detectKind(input),
    custom: custom ?? null,
    status: { state: 'pending' },
    progress: 0,
    speed_x: 0,
    eta_s: 0,
    fps: 0,
    duration_us: 0,
    stderr_tail: [],
    error: null
  }
}

export function useTranscodeQueue () {
  const state = useState<QueueState>('wgr-clip-queue', () => ({
    jobs: new Map(),
    videoPreset: 'source',
    imagePreset: 'source',
    audioPreset: 'source',
    custom: { ...DEFAULT_CUSTOM },
    outputDir: null,
    appInfo: null,
    listenersBound: false,
    unlisteners: []
  }))

  function presetForKind (kind: MediaKind): Preset {
    switch (kind) {
      case 'image': return state.value.imagePreset
      case 'audio': return state.value.audioPreset
      case 'video':
      default: return state.value.videoPreset
    }
  }

  // Reactive map exposed as a sorted array for templates
  const jobsList = computed<Job[]>(() => Array.from(state.value.jobs.values()))

  const counts = computed(() => {
    let pending = 0
    let active = 0
    let done = 0
    let error = 0
    let cancelled = 0
    for (const j of state.value.jobs.values()) {
      switch (j.status.state) {
        case 'pending':
        case 'probing':
          pending += 1
          break
        case 'encoding':
          active += 1
          break
        case 'done':
          done += 1
          break
        case 'error':
          error += 1
          break
        case 'cancelled':
          cancelled += 1
          break
      }
    }
    const total = state.value.jobs.size
    const sumPercent = jobsList.value.reduce<number>((acc, j) => acc + (j.status.state === 'done' ? 1 : j.progress), 0)
    const overall = total > 0 ? sumPercent / total : 0
    return { pending, active, done, error, cancelled, total, overall }
  })

  function patch (id: string, mut: (j: Job) => void) {
    const cur = state.value.jobs.get(id)
    if (!cur) return
    const next = { ...cur }
    mut(next)
    const m = new Map(state.value.jobs)
    m.set(id, next)
    state.value.jobs = m
  }

  async function bindListeners () {
    if (state.value.listenersBound) return
    state.value.listenersBound = true

    // Restore persisted settings (preset + outputDir + custom params).
    const persisted = await loadSettings()
    if (persisted.videoPreset) state.value.videoPreset = persisted.videoPreset
    if (persisted.imagePreset) state.value.imagePreset = persisted.imagePreset
    if (persisted.audioPreset) state.value.audioPreset = persisted.audioPreset
    if (persisted.outputDir !== undefined) state.value.outputDir = persisted.outputDir
    if (persisted.custom) state.value.custom = { ...DEFAULT_CUSTOM, ...persisted.custom }

    const u1 = await listen<ProgressTick>('transcode://progress', (e) => {
      patch(e.payload.job_id, (j) => {
        j.status = { state: 'encoding' }
        j.progress = e.payload.percent
        j.speed_x = e.payload.speed_x
        j.eta_s = e.payload.eta_s
        j.fps = e.payload.fps
      })
    })

    const u2 = await listen<JobDoneEvent>('transcode://done', (e) => {
      patch(e.payload.job_id, (j) => {
        j.status = { state: 'done' }
        j.progress = 1
        j.eta_s = 0
        j.output = e.payload.output
        j.error = null
      })
    })

    const u3 = await listen<JobErrorEvent>('transcode://error', (e) => {
      patch(e.payload.job_id, (j) => {
        j.status = { state: 'error' }
        j.error = e.payload.error
        j.stderr_tail = e.payload.stderr_tail
      })
    })

    const u4 = await listen<JobCancelledEvent>('transcode://cancelled', (e) => {
      patch(e.payload.job_id, (j) => {
        j.status = { state: 'cancelled' }
        j.error = { kind: 'Cancelled' }
      })
    })

    state.value.unlisteners = [u1, u2, u3, u4]

    try {
      state.value.appInfo = await invoke<AppInfo>('get_app_info')
    } catch (err) {
      console.warn('get_app_info failed', err)
    }
  }

  async function addInputs (rawPaths: string[]) {
    console.log('[queue] addInputs called with', rawPaths.length, 'paths', rawPaths)
    if (rawPaths.length === 0) return

    // iCloud Drive placeholders: tiny stubs named `.<original>.<ext>.icloud`
    // that don't actually contain the file content. ffmpeg can't read them —
    // surface a specific message so the user knows what to do.
    const icloudStubs = rawPaths.filter(p => p.toLowerCase().endsWith('.icloud'))
    if (icloudStubs.length > 0) {
      const names = icloudStubs.map(p => {
        const base = p.split(/[/\\]/).pop() ?? p
        // .Elouan.wav.icloud → Elouan.wav
        return base.replace(/^\./, '').replace(/\.icloud$/i, '')
      }).join(', ')
      useToast().add({
        title: 'Fichier iCloud non téléchargé',
        description: `${names} : ouvrez-le dans Finder (clic droit → Télécharger maintenant) puis réessayez.`,
        color: 'warning',
        duration: 7000
      })
      // If everything dropped is iCloud stubs, abort. Otherwise filter them out and continue.
      rawPaths = rawPaths.filter(p => !p.toLowerCase().endsWith('.icloud'))
      if (rawPaths.length === 0) return
    }

    let expanded: string[]
    try {
      expanded = await invoke<string[]>('expand_paths', { paths: rawPaths })
    } catch (err) {
      console.error('[queue] expand_paths failed', err)
      useToast().add({
        title: 'Erreur de lecture du drop',
        description: String(err),
        color: 'error'
      })
      return
    }
    console.log('[queue] expand_paths returned', expanded.length, 'media files', expanded)
    if (expanded.length === 0) {
      const names = rawPaths.map(p => p.split(/[/\\]/).pop() ?? p).join(', ')
      useToast().add({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : vidéo, image ou audio courants. Reçu : ${names}`,
        color: 'warning'
      })
      return
    }

    // Group by detected kind so each batch gets the kind-specific preset.
    const groups = new Map<MediaKind, string[]>()
    for (const path of expanded) {
      const kind = detectKind(path)
      const arr = groups.get(kind) ?? []
      arr.push(path)
      groups.set(kind, arr)
    }

    const m = new Map(state.value.jobs)
    for (const [kind, inputs] of groups) {
      const preset = presetForKind(kind)
      const customForJob = preset === 'custom' ? { ...state.value.custom } : null
      let ids: string[]
      try {
        ids = await invoke<string[]>('start_jobs', {
          args: {
            inputs,
            preset,
            custom: customForJob,
            output_dir: state.value.outputDir
          }
        })
      } catch (err) {
        console.error('[queue] start_jobs failed', err)
        useToast().add({
          title: `Échec du démarrage (${kind})`,
          description: String(err),
          color: 'error'
        })
        continue
      }
      inputs.forEach((input, i) => {
        const id = ids[i]
        if (!id) return
        m.set(id, makeJob(id, input, '', preset, kind, customForJob))
      })
    }
    state.value.jobs = m
  }

  async function cancel (id: string) {
    await invoke('cancel_job', { id })
  }

  async function cancelAll () {
    await invoke('cancel_all')
  }

  async function retry (id: string) {
    const newId = await invoke<string>('retry_job', { id })
    const m = new Map(state.value.jobs)
    const old = m.get(id)
    m.delete(id)
    if (old) m.set(newId, makeJob(newId, old.input, old.output, old.preset, old.kind, old.custom))
    state.value.jobs = m
  }

  async function pickOutputDir () {
    const result = await open({ directory: true, multiple: false })
    if (typeof result === 'string') {
      state.value.outputDir = result
      void saveSettings({ outputDir: result })
    }
  }

  async function pickInputFiles () {
    const result = await open({
      multiple: true,
      filters: [
        { name: 'Médias', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mts', 'm2ts', 'ts', '3gp', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif'] }
      ]
    })
    if (Array.isArray(result) && result.length > 0) {
      await addInputs(result)
    } else if (typeof result === 'string') {
      await addInputs([result])
    }
  }

  function setPreset (kind: MediaKind, p: Preset) {
    if (kind === 'video') state.value.videoPreset = p
    else if (kind === 'image') state.value.imagePreset = p
    else if (kind === 'audio') state.value.audioPreset = p
    void saveSettings({ videoPreset: state.value.videoPreset, imagePreset: state.value.imagePreset, audioPreset: state.value.audioPreset })
  }

  function patchCustom (patch: Partial<CustomParams>) {
    state.value.custom = { ...state.value.custom, ...patch }
    void saveSettings({ custom: state.value.custom })
  }

  async function copyDiagnostics (id: string) {
    const diag = await invoke<unknown>('get_diagnostics', { id })
    await writeText(JSON.stringify(diag, null, 2))
  }

  async function revealInFolder (path: string) {
    await invoke('reveal_in_folder', { path })
  }

  async function openLogsDir () {
    await invoke('open_logs_dir')
  }

  function clearFinished () {
    const m = new Map<string, Job>()
    for (const [k, v] of state.value.jobs) {
      if (v.status.state !== 'done' && v.status.state !== 'cancelled') m.set(k, v)
    }
    state.value.jobs = m
  }

  return {
    jobs: jobsList,
    counts,
    videoPreset: computed(() => state.value.videoPreset),
    imagePreset: computed(() => state.value.imagePreset),
    audioPreset: computed(() => state.value.audioPreset),
    custom: computed(() => state.value.custom),
    outputDir: computed(() => state.value.outputDir),
    appInfo: computed(() => state.value.appInfo),
    bindListeners,
    addInputs,
    cancel,
    cancelAll,
    retry,
    pickOutputDir,
    pickInputFiles,
    setPreset,
    patchCustom,
    copyDiagnostics,
    revealInFolder,
    openLogsDir,
    clearFinished
  }
}
