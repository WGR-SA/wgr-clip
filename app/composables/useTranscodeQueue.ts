import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type {
  AppInfo,
  Job,
  JobCancelledEvent,
  JobDoneEvent,
  JobErrorEvent,
  Preset,
  ProgressTick
} from '~/types/job'

interface QueueState {
  jobs: Map<string, Job>
  preset: Preset
  outputDir: string | null
  appInfo: AppInfo | null
  listenersBound: boolean
  unlisteners: UnlistenFn[]
}

function makeJob (id: string, input: string, output: string, preset: Preset): Job {
  return {
    id,
    input,
    output,
    preset,
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
    preset: 'web1080p',
    outputDir: null,
    appInfo: null,
    listenersBound: false,
    unlisteners: []
  }))

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
    const sumPercent = jobsList.value.reduce((acc, j) => acc + (j.status.state === 'done' ? 1 : j.progress), 0)
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
    if (rawPaths.length === 0) return
    const expanded = await invoke<string[]>('expand_paths', { paths: rawPaths })
    if (expanded.length === 0) return

    const ids = await invoke<string[]>('start_jobs', {
      args: {
        inputs: expanded,
        preset: state.value.preset,
        output_dir: state.value.outputDir
      }
    })
    const m = new Map(state.value.jobs)
    expanded.forEach((input, i) => {
      const id = ids[i]
      if (!id) return
      m.set(id, makeJob(id, input, '', state.value.preset))
    })
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
    if (old) m.set(newId, makeJob(newId, old.input, old.output, old.preset))
    state.value.jobs = m
  }

  async function pickOutputDir () {
    const result = await open({ directory: true, multiple: false })
    if (typeof result === 'string') {
      state.value.outputDir = result
    }
  }

  function setPreset (p: Preset) {
    state.value.preset = p
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
    preset: computed(() => state.value.preset),
    outputDir: computed(() => state.value.outputDir),
    appInfo: computed(() => state.value.appInfo),
    bindListeners,
    addInputs,
    cancel,
    cancelAll,
    retry,
    pickOutputDir,
    setPreset,
    copyDiagnostics,
    revealInFolder,
    openLogsDir,
    clearFinished
  }
}
