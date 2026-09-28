import { describe, expect, it, vi, type Mock } from 'vitest'
import { createDropDispatcher, type DispatcherHandler, type DispatcherTarget } from './dropDispatcher'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function harness(opts: { dpr?: number, fail?: boolean } = {}) {
  let handler: DispatcherHandler | null = null
  const unlisten = vi.fn()
  const pendingResolvers: (() => void)[] = []
  const attach = vi.fn((h: DispatcherHandler) => {
    handler = h
    if (opts.fail) return Promise.reject(new Error('no webview'))
    return new Promise<() => void>((resolve) => {
      pendingResolvers.push(() => resolve(unlisten))
    })
  })
  const hovered: (string | null)[] = []
  const onEmptyDrop = vi.fn()
  const onAttachError = vi.fn()
  const dispatcher = createDropDispatcher({
    attach,
    dpr: () => opts.dpr ?? 1,
    fallbackOrder: ['convert', 'crop'],
    onEmptyDrop,
    onAttachError,
    setHovered: id => hovered.push(id)
  })
  function zone(id: string, left: number): DispatcherTarget & { onDrop: Mock<(paths: string[]) => void> } {
    return { id, bounds: () => ({ left, top: 0, right: left + 100, bottom: 100 }), onDrop: vi.fn<(paths: string[]) => void>() }
  }
  async function resolveAttach() {
    pendingResolvers.splice(0).forEach(r => r())
    await flush()
  }
  return {
    dispatcher,
    attach,
    unlisten,
    zone,
    resolveAttach,
    hovered,
    onEmptyDrop,
    onAttachError,
    fire: (e: Parameters<DispatcherHandler>[0]) => handler!(e)
  }
}

describe('createDropDispatcher listener lifecycle', () => {
  it('attaches one listener when two zones register in the same tick', async () => {
    const h = harness()
    h.dispatcher.register(h.zone('convert', 0))
    h.dispatcher.register(h.zone('crop', 200))
    await h.resolveAttach()
    expect(h.attach).toHaveBeenCalledTimes(1)
  })

  it('detaches once when the last zone leaves and re-attaches on the next register', async () => {
    const h = harness()
    const offA = h.dispatcher.register(h.zone('convert', 0))
    const offB = h.dispatcher.register(h.zone('crop', 200))
    await h.resolveAttach()
    offA()
    await flush()
    expect(h.unlisten).not.toHaveBeenCalled()
    offB()
    await flush()
    expect(h.unlisten).toHaveBeenCalledTimes(1)
    h.dispatcher.register(h.zone('crop', 200))
    expect(h.attach).toHaveBeenCalledTimes(2)
  })

  it('a release before attach resolves still detaches once it resolves', async () => {
    const h = harness()
    const off = h.dispatcher.register(h.zone('convert', 0))
    off()
    await h.resolveAttach()
    expect(h.unlisten).toHaveBeenCalledTimes(1)
  })

  it('reports an attach failure once and does not retry while zones stay registered', async () => {
    const h = harness({ fail: true })
    h.dispatcher.register(h.zone('convert', 0))
    h.dispatcher.register(h.zone('crop', 200))
    await flush()
    expect(h.onAttachError).toHaveBeenCalledTimes(1)
    expect(h.attach).toHaveBeenCalledTimes(1)
  })
})

describe('createDropDispatcher routing', () => {
  it('routes a drop to the zone under the cursor', async () => {
    const h = harness()
    const convert = h.zone('convert', 0)
    const crop = h.zone('crop', 200)
    h.dispatcher.register(convert)
    h.dispatcher.register(crop)
    await h.resolveAttach()
    h.fire({ type: 'drop', position: { x: 250, y: 50 }, paths: ['a.jpg'] })
    expect(crop.onDrop).toHaveBeenCalledWith(['a.jpg'])
    expect(convert.onDrop).not.toHaveBeenCalled()
  })

  it('falls back to the convert zone when the drop lands outside every zone', async () => {
    const h = harness()
    const convert = h.zone('convert', 0)
    const crop = h.zone('crop', 200)
    h.dispatcher.register(convert)
    h.dispatcher.register(crop)
    await h.resolveAttach()
    h.fire({ type: 'drop', position: { x: 150, y: 50 }, paths: ['a.mov'] })
    expect(convert.onDrop).toHaveBeenCalledWith(['a.mov'])
    expect(crop.onDrop).not.toHaveBeenCalled()
  })

  it('falls back to the crop zone when the convert zone is not registered (editor open)', async () => {
    const h = harness()
    const crop = h.zone('crop', 200)
    h.dispatcher.register(crop)
    await h.resolveAttach()
    h.fire({ type: 'drop', position: { x: 10, y: 500 }, paths: ['b.jpg'] })
    expect(crop.onDrop).toHaveBeenCalledWith(['b.jpg'])
  })

  it('reports an empty drop instead of routing it', async () => {
    const h = harness()
    const convert = h.zone('convert', 0)
    h.dispatcher.register(convert)
    await h.resolveAttach()
    h.fire({ type: 'drop', position: { x: 10, y: 10 }, paths: [] })
    expect(h.onEmptyDrop).toHaveBeenCalledTimes(1)
    expect(convert.onDrop).not.toHaveBeenCalled()
  })

  it('tracks hover with the same fallback and clears it on leave and drop', async () => {
    const h = harness()
    h.dispatcher.register(h.zone('convert', 0))
    h.dispatcher.register(h.zone('crop', 200))
    await h.resolveAttach()
    h.fire({ type: 'enter', position: { x: 250, y: 50 } })
    h.fire({ type: 'over', position: { x: 150, y: 50 } })
    h.fire({ type: 'leave' })
    h.fire({ type: 'drop', position: { x: 250, y: 50 }, paths: ['a.jpg'] })
    expect(h.hovered).toEqual(['crop', 'convert', null, null])
  })

  it('converts physical positions with the device pixel ratio', async () => {
    const h = harness({ dpr: 2 })
    const convert = h.zone('convert', 0)
    const crop = h.zone('crop', 200)
    h.dispatcher.register(convert)
    h.dispatcher.register(crop)
    await h.resolveAttach()
    h.fire({ type: 'drop', position: { x: 500, y: 100 }, paths: ['a.jpg'] })
    expect(crop.onDrop).toHaveBeenCalledWith(['a.jpg'])
  })
})
