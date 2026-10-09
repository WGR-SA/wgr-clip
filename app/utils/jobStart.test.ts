import { describe, expect, it, vi } from 'vitest'
import type { CropRect, StagedItem, ToastSpec } from '~/types/job'
import { groupStartBatches, startBatches, type JobStartDeps, type StartedJob, type StartJobsArgs } from './jobStart'

const RECT_A: CropRect = { x: 0, y: 0, w: 0.5, h: 0.5 }
const RECT_B: CropRect = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }

function item(uid: string, input: string, kind: StagedItem['kind'], crop: CropRect | null = null): StagedItem {
  return { uid, input, kind, crop, cropPx: crop ? { width: 1, height: 1 } : null }
}

interface Call { inputs: string[], crop: CropRect | null, preset: string, slug: string | null, outputDir: string | null }

function harness(overrides: Partial<JobStartDeps> = {}) {
  const calls: Call[] = []
  const jobs: StartedJob[] = []
  const toasts: ToastSpec[] = []
  let n = 0
  const deps: JobStartDeps = {
    startJobs: async (args) => {
      calls.push({ inputs: args.inputs, crop: args.crop, preset: args.preset, slug: args.slug, outputDir: args.output_dir })
      return args.inputs.map(() => `id${++n}`)
    },
    resolveSelection: kind => ({ preset: 'source', custom: null, slug: kind === 'image' ? 'web' : null }),
    outputDir: () => '/out',
    onJobs: started => void jobs.push(...started),
    toast: t => void toasts.push(t),
    ...overrides
  }
  return { deps, calls, jobs, toasts }
}

describe('groupStartBatches', () => {
  it('coalesces uncropped items of the same kind into one batch', () => {
    const batches = groupStartBatches([
      item('1', '/a.jpg', 'image'),
      item('2', '/b.mov', 'video'),
      item('3', '/c.jpg', 'image')
    ])
    expect(batches).toHaveLength(2)
    expect(batches[0]).toMatchObject({ kind: 'image', crop: null, inputs: ['/a.jpg', '/c.jpg'], uids: ['1', '3'] })
    expect(batches[1]).toMatchObject({ kind: 'video', crop: null, inputs: ['/b.mov'], uids: ['2'] })
  })

  it('gives every cropped image a batch of its own', () => {
    const batches = groupStartBatches([
      item('1', '/a.jpg', 'image', RECT_A),
      item('2', '/b.jpg', 'image', RECT_B),
      item('3', '/c.jpg', 'image')
    ])
    expect(batches).toHaveLength(3)
    expect(batches.map(b => b.crop)).toEqual([RECT_A, RECT_B, null])
  })

  it('returns nothing for an empty list', () => {
    expect(groupStartBatches([])).toEqual([])
  })
})

describe('startBatches', () => {
  it('passes the resolved preset, slug, output dir and crop to each call', async () => {
    const h = harness()
    const started = await startBatches([item('1', '/a.jpg', 'image', RECT_A)], h.deps)
    expect(h.calls).toEqual([{ inputs: ['/a.jpg'], crop: RECT_A, preset: 'source', slug: 'web', outputDir: '/out' }])
    expect(started).toEqual(['1'])
  })

  it('reports each started job with its id, input, kind, crop, preset and custom', async () => {
    const h = harness()
    await startBatches([item('1', '/a.jpg', 'image', RECT_A), item('2', '/b.mov', 'video')], h.deps)
    expect(h.jobs).toMatchObject([
      { id: 'id1', input: '/a.jpg', kind: 'image', crop: RECT_A, preset: 'source', custom: null },
      { id: 'id2', input: '/b.mov', kind: 'video', crop: null, preset: 'source', custom: null }
    ])
  })

  // Review Focus 5
  it('issues no call at all for an empty staging list', async () => {
    const h = harness()
    expect(await startBatches([], h.deps)).toEqual([])
    expect(h.calls).toEqual([])
  })

  // Review Focus 4
  it('keeps going when one batch fails and returns only the uids that started', async () => {
    const h = harness({
      startJobs: vi.fn(async (args: StartJobsArgs) => {
        if (args.inputs[0]!.endsWith('.mov')) throw new Error('ffmpeg missing')
        return args.inputs.map((_, i) => `ok${i}`)
      })
    })
    const started = await startBatches([
      item('1', '/a.jpg', 'image'),
      item('2', '/b.mov', 'video'),
      item('3', '/c.jpg', 'image')
    ], h.deps)
    expect(started).toEqual(['1', '3'])
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]?.title).toBe('Échec du démarrage (vidéo)')
  })

  it('never starts a batch before the previous one has returned', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const gate = new Promise<void>((res) => {
      releaseFirst = res
    })
    const h = harness({
      startJobs: async (args) => {
        order.push(`start:${args.inputs[0]}`)
        if (args.inputs[0] === '/a.jpg') await gate
        order.push(`end:${args.inputs[0]}`)
        return args.inputs.map(() => 'id')
      }
    })
    const running = startBatches([item('1', '/a.jpg', 'image'), item('2', '/b.mov', 'video')], h.deps)
    await new Promise(r => setTimeout(r, 0))
    expect(order).toEqual(['start:/a.jpg'])
    releaseFirst()
    await running
    expect(order).toEqual(['start:/a.jpg', 'end:/a.jpg', 'start:/b.mov', 'end:/b.mov'])
  })
})
