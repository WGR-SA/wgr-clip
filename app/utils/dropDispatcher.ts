import { pickDropTarget, type DropZoneBounds, type DropZoneRect } from './dropHitTest'

export interface DispatcherTarget {
  id: string
  bounds: () => DropZoneRect | null
  onDrop: (paths: string[]) => void
}

interface Position { x: number, y: number }

export type DispatcherEvent
  = { type: 'enter' | 'over', position: Position }
    | { type: 'leave' }
    | { type: 'drop', position: Position, paths: string[] }

export type DispatcherHandler = (e: DispatcherEvent) => void

export interface DispatcherDeps {
  attach: (handler: DispatcherHandler) => Promise<() => void>
  dpr: () => number
  fallbackOrder: readonly string[]
  onEmptyDrop: () => void
  onAttachError: (e: unknown) => void
  setHovered: (id: string | null) => void
}

export function createDropDispatcher(deps: DispatcherDeps) {
  const targets = new Map<string, DispatcherTarget>()
  let listening: Promise<(() => void) | null> | null = null

  function zones(): DropZoneBounds[] {
    const out: DropZoneBounds[] = []
    for (const t of targets.values()) {
      const rect = t.bounds()
      if (rect) out.push({ id: t.id, rect })
    }
    return out
  }

  function resolveTarget(position: { x: number, y: number }): string | null {
    return pickDropTarget(position, deps.dpr(), zones())
      ?? deps.fallbackOrder.find(id => targets.has(id))
      ?? null
  }

  function handle(e: DispatcherEvent) {
    if (e.type === 'enter' || e.type === 'over') {
      deps.setHovered(resolveTarget(e.position))
    } else if (e.type === 'leave') {
      deps.setHovered(null)
    } else if (e.type === 'drop') {
      const id = resolveTarget(e.position)
      deps.setHovered(null)
      if (e.paths.length === 0) {
        deps.onEmptyDrop()
        return
      }
      if (id) targets.get(id)?.onDrop(e.paths)
    }
  }

  function ensureListening() {
    // Guard on the in-flight promise: two zones mount in the same tick and
    // the first attach has not resolved when the second one asks.
    listening ??= deps.attach(handle).catch((err: unknown) => {
      deps.onAttachError(err)
      return null
    })
  }

  function register(target: DispatcherTarget): () => void {
    targets.set(target.id, target)
    ensureListening()
    return () => {
      targets.delete(target.id)
      if (targets.size === 0 && listening) {
        const pending = listening
        listening = null
        void pending.then(unlisten => unlisten?.())
      }
    }
  }

  return { register }
}
