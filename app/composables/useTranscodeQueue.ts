import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { loadSettings, saveSettings } from '~/composables/useSettingsStore'
import { useUserPresets } from '~/composables/useUserPresets'
import { detectKind } from '~/utils/mediaKind'
import { startBatches, type ResolvedPreset } from '~/utils/jobStart'
import type {
  AppInfo,
  CropRect,
  CustomParams,
  Job,
  JobCancelledEvent,
  JobDoneEvent,
  JobErrorEvent,
  MediaKind,
  Preset,
  PresetSelection,
  ProgressTick,
  StagedItem
} from '~/types/job'
import { isBuiltinPreset, toCustomParams, userIdFromSelection } from '~/utils/userPresets'

export const DEFAULT_CUSTOM: CustomParams = {
  video_max_width: 0,
  video_max_height: 1080,
  video_crf: 22,
  video_audio_kbps: 128,
  image_max_width: 2000,
  image_max_height: 2000,
  image_quality: 85,
  audio_kbps: 192
}

interface QueueState {
  jobs: Map<string, Job>
  videoPreset: PresetSelection
  imagePreset: PresetSelection
  audioPreset: PresetSelection
  custom: CustomParams
  outputDir: string | null
  appInfo: AppInfo | null
  listenersBound: boolean
  unlisteners: UnlistenFn[]
}

function makeJob(id: string, input: string, output: string, preset: Preset, kind?: MediaKind, custom?: CustomParams | null, crop?: CropRect | null): Job {
  return {
    id,
    input,
    output,
    preset,
    kind: kind ?? detectKind(input),
    custom: custom ?? null,
    crop: crop ?? null,
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

export function useTranscodeQueue() {
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

  const userPresets = useUserPresets()

  function presetForKind(kind: MediaKind): PresetSelection {
    switch (kind) {
      case 'image': return state.value.imagePreset
      case 'audio': return state.value.audioPreset
      case 'video':
      default: return state.value.videoPreset
    }
  }

  // An imported preset rides on the built-in `custom` path with its own
  // params and output suffix. A selection pointing at a preset that was
  // deleted since falls back to Original and heals the persisted choice.
  function resolveSelection(kind: MediaKind): ResolvedPreset {
    const selection = presetForKind(kind)
    if (isBuiltinPreset(selection)) {
      return {
        preset: selection,
        custom: selection === 'custom' ? { ...state.value.custom } : null,
        slug: null
      }
    }
    const id = userIdFromSelection(selection)
    const user = id === null ? undefined : userPresets.byId(id)
    if (!user) {
      setPreset(kind, 'source')
      return { preset: 'source', custom: null, slug: null }
    }
    return { preset: 'custom', custom: toCustomParams(user, state.value.custom), slug: user.id }
  }

  function isAvailable(selection: PresetSelection): boolean {
    const id = userIdFromSelection(selection)
    return id === null || userPresets.byId(id) !== undefined
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

  function patch(id: string, mut: (j: Job) => void) {
    const cur = state.value.jobs.get(id)
    if (!cur) return
    const next = { ...cur }
    mut(next)
    const m = new Map(state.value.jobs)
    m.set(id, next)
    state.value.jobs = m
  }

  async function bindListeners() {
    if (state.value.listenersBound) return
    state.value.listenersBound = true

    // Restore persisted settings (presets + outputDir + custom params).
    const persisted = await loadSettings()
    if (persisted.userPresets) userPresets.hydrate(persisted.userPresets)
    if (persisted.videoPreset && isAvailable(persisted.videoPreset)) state.value.videoPreset = persisted.videoPreset
    if (persisted.imagePreset && isAvailable(persisted.imagePreset)) state.value.imagePreset = persisted.imagePreset
    if (persisted.audioPreset && isAvailable(persisted.audioPreset)) state.value.audioPreset = persisted.audioPreset
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

  async function startStaged(items: StagedItem[]): Promise<string[]> {
    const uids = await startBatches(items, {
      startJobs: args => invoke<string[]>('start_jobs', { args }),
      resolveSelection,
      outputDir: () => state.value.outputDir,
      onJobs: (started) => {
        const m = new Map(state.value.jobs)
        for (const j of started) m.set(j.id, makeJob(j.id, j.input, '', j.preset, j.kind, j.custom, j.crop))
        state.value.jobs = m
      },
      toast: spec => useToast().add(spec)
    })
    return uids
  }

  async function cancel(id: string) {
    await invoke('cancel_job', { id })
  }

  async function cancelAll() {
    await invoke('cancel_all')
  }

  async function retry(id: string) {
    const newId = await invoke<string>('retry_job', { id })
    const m = new Map(state.value.jobs)
    const old = m.get(id)
    m.delete(id)
    if (old) m.set(newId, makeJob(newId, old.input, old.output, old.preset, old.kind, old.custom, old.crop))
    state.value.jobs = m
  }

  async function pickOutputDir() {
    const result = await open({ directory: true, multiple: false })
    if (typeof result === 'string') {
      state.value.outputDir = result
      void saveSettings({ outputDir: result })
    }
  }

  function setPreset(kind: MediaKind, p: PresetSelection) {
    if (kind === 'video') state.value.videoPreset = p
    else if (kind === 'image') state.value.imagePreset = p
    else if (kind === 'audio') state.value.audioPreset = p
    void saveSettings({ videoPreset: state.value.videoPreset, imagePreset: state.value.imagePreset, audioPreset: state.value.audioPreset })
  }

  function patchCustom(patch: Partial<CustomParams>) {
    state.value.custom = { ...state.value.custom, ...patch }
    void saveSettings({ custom: state.value.custom })
  }

  async function copyDiagnostics(id: string) {
    const diag = await invoke<unknown>('get_diagnostics', { id })
    await writeText(JSON.stringify(diag, null, 2))
  }

  async function revealInFolder(path: string) {
    await invoke('reveal_in_folder', { path })
  }

  async function openLogsDir() {
    await invoke('open_logs_dir')
  }

  function clearFinished() {
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
    startStaged,
    cancel,
    cancelAll,
    retry,
    pickOutputDir,
    setPreset,
    patchCustom,
    copyDiagnostics,
    revealInFolder,
    openLogsDir,
    clearFinished
  }
}
