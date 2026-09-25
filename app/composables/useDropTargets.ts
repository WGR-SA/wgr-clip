import { getCurrentWebview } from '@tauri-apps/api/webview'
import { createDropDispatcher, type DispatcherHandler } from '~/utils/dropDispatcher'

export const CONVERT_ZONE_ID = 'convert'
export const CROP_ZONE_ID = 'crop'

export interface DropTarget {
  id: string
  el: Ref<HTMLElement | null>
  onDrop: (paths: string[]) => void
}

// One dispatcher per webview: zones come and go, the Tauri listener is
// attached once and detached when the last zone leaves.
let dispatcher: ReturnType<typeof createDropDispatcher> | null = null

function attach(handler: DispatcherHandler) {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload
    if (p.type === 'enter' || p.type === 'over') handler({ type: p.type, position: p.position })
    else if (p.type === 'leave') handler({ type: 'leave' })
    else handler({ type: 'drop', position: p.position, paths: p.paths })
  })
}

export function useDropTargets() {
  const hoveredId = useState<string | null>('wgr-clip-drop-hover', () => null)
  const toast = useToast()

  dispatcher ??= createDropDispatcher({
    attach,
    dpr: () => window.devicePixelRatio,
    fallbackOrder: [CONVERT_ZONE_ID, CROP_ZONE_ID],
    setHovered: (id) => {
      hoveredId.value = id
    },
    onEmptyDrop: () => toast.add({
      title: 'Drop vide',
      description: 'Aucun chemin de fichier reçu. Essayez un autre dossier.',
      color: 'warning'
    }),
    onAttachError: (e) => {
      console.error('[drop] failed to attach listener', e)
      toast.add({
        title: 'Drag-drop indisponible',
        description: 'Le listener Tauri n\'a pas pu être attaché. Essayez de relancer l\'app.',
        color: 'error'
      })
    }
  })
  const d = dispatcher

  function register(target: DropTarget): () => void {
    return d.register({
      id: target.id,
      onDrop: target.onDrop,
      bounds: () => {
        const r = target.el.value?.getBoundingClientRect()
        return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
      }
    })
  }

  return { hoveredId, register }
}
