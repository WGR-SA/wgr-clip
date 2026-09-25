import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { pickDropTarget, type DropZoneBounds } from '~/utils/dropHitTest'

export const CONVERT_ZONE_ID = 'convert'
export const CROP_ZONE_ID = 'crop'

export interface DropTarget {
  id: string
  el: Ref<HTMLElement | null>
  onDrop: (paths: string[]) => void
}

// One webview-wide Tauri listener shared by every zone; module scope so
// registering a second zone never attaches a second listener.
const targets = new Map<string, DropTarget>()
let unlisten: UnlistenFn | null = null

export function useDropTargets() {
  const hoveredId = useState<string | null>('wgr-clip-drop-hover', () => null)

  function bounds(): DropZoneBounds[] {
    const out: DropZoneBounds[] = []
    for (const t of targets.values()) {
      const r = t.el.value?.getBoundingClientRect()
      if (r) out.push({ id: t.id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
    }
    return out
  }

  function hitTest(position: { x: number, y: number }): string | null {
    return pickDropTarget(position, window.devicePixelRatio, bounds())
  }

  function fallbackId(): string | null {
    return targets.has(CONVERT_ZONE_ID) ? CONVERT_ZONE_ID : null
  }

  async function ensureListening() {
    if (unlisten) return
    try {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload
        if (p.type === 'enter' || p.type === 'over') {
          hoveredId.value = hitTest(p.position) ?? fallbackId()
        } else if (p.type === 'leave') {
          hoveredId.value = null
        } else if (p.type === 'drop') {
          const id = hitTest(p.position) ?? fallbackId()
          hoveredId.value = null
          if (p.paths.length === 0) {
            useToast().add({
              title: 'Drop vide',
              description: 'Aucun chemin de fichier reçu. Essayez un autre dossier.',
              color: 'warning'
            })
            return
          }
          if (id) targets.get(id)?.onDrop(p.paths)
        }
      })
    } catch (e) {
      console.error('[drop] failed to attach listener', e)
      useToast().add({
        title: 'Drag-drop indisponible',
        description: 'Le listener Tauri n\'a pas pu être attaché. Essayez de relancer l\'app.',
        color: 'error'
      })
    }
  }

  function register(target: DropTarget): () => void {
    targets.set(target.id, target)
    void ensureListening()
    return () => {
      targets.delete(target.id)
      if (targets.size === 0 && unlisten) {
        unlisten()
        unlisten = null
      }
    }
  }

  return { hoveredId, register }
}
