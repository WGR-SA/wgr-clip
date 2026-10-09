import type { CropRect, CustomParams, MediaKind, Preset, StagedItem, ToastSpec } from '~/types/job'

export interface StartBatch {
  kind: MediaKind
  crop: CropRect | null
  uids: string[]
  inputs: string[]
}

export interface ResolvedPreset {
  preset: Preset
  custom: CustomParams | null
  slug: string | null
}

export interface StartJobsArgs {
  inputs: string[]
  preset: Preset
  custom: CustomParams | null
  slug: string | null
  output_dir: string | null
  crop: CropRect | null
}

export interface StartedJob {
  id: string
  input: string
  kind: MediaKind
  preset: Preset
  custom: CustomParams | null
  crop: CropRect | null
}

export interface JobStartDeps {
  startJobs: (args: StartJobsArgs) => Promise<string[]>
  resolveSelection: (kind: MediaKind) => ResolvedPreset
  outputDir: () => string | null
  onJobs: (started: StartedJob[]) => void
  toast: (spec: ToastSpec) => void
}

// start_jobs applies one crop to the whole batch, so a cropped image cannot
// share a call with anything else.
export function groupStartBatches(items: StagedItem[]): StartBatch[] {
  const batches: StartBatch[] = []
  for (const item of items) {
    const open = item.crop === null
      ? batches.find(b => b.kind === item.kind && b.crop === null)
      : undefined
    if (open) {
      open.uids.push(item.uid)
      open.inputs.push(item.input)
    } else {
      batches.push({ kind: item.kind, crop: item.crop, uids: [item.uid], inputs: [item.input] })
    }
  }
  return batches
}

export async function startBatches(items: StagedItem[], deps: JobStartDeps): Promise<string[]> {
  const started: string[] = []
  // Sequential on purpose: start_jobs seeds its `claimed` output set from jobs
  // already in flight, so serialising is what stops a second crop of the same
  // source from overwriting the first one's file.
  for (const batch of groupStartBatches(items)) {
    const { preset, custom, slug } = deps.resolveSelection(batch.kind)
    let ids: string[]
    try {
      ids = await deps.startJobs({
        inputs: batch.inputs,
        preset,
        custom,
        slug,
        output_dir: deps.outputDir(),
        crop: batch.crop
      })
    } catch (e) {
      deps.toast({
        title: `Échec du démarrage (${batch.kind})`,
        description: String(e),
        color: 'error'
      })
      continue
    }
    const jobs: StartedJob[] = []
    batch.inputs.forEach((input, i) => {
      const id = ids[i]
      if (id) jobs.push({ id, input, kind: batch.kind, preset, custom, crop: batch.crop })
    })
    deps.onJobs(jobs)
    started.push(...batch.uids)
  }
  return started
}
