import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { MediaSize } from '~/types/job'
import { IMAGE_EXTS, detectKind } from '~/composables/useTranscodeQueue'
import { createCropSession, initialCropState, type CropState } from '~/utils/cropSession'

// Decoded dimensions of the preview: ffmpeg autorotates, ffprobe does not,
// and this is what tells the two apart.
async function decodeSize(url: string): Promise<MediaSize> {
  const img = new Image()
  img.src = url
  await img.decode()
  return { width: img.naturalWidth, height: img.naturalHeight }
}

export function useCropSession() {
  const state = useState<CropState>('wgr-clip-crop', initialCropState)
  const queue = useTranscodeQueue()
  const toast = useToast()

  return createCropSession(state, {
    detectKind,
    expandPaths: paths => invoke<string[]>('expand_paths', { paths }),
    renderPreview: input => invoke<ArrayBuffer>('render_crop_preview', { input }),
    probeSize: input => invoke<MediaSize>('probe_media_size', { input }),
    toUrl: bytes => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })),
    revokeUrl: url => URL.revokeObjectURL(url),
    previewSize: decodeSize,
    toast: spec => toast.add(spec),
    addCroppedInput: queue.addCroppedInput,
    pickImages: async () => {
      const result = await openDialog({
        multiple: true,
        filters: [{ name: 'Images', extensions: [...IMAGE_EXTS] }]
      })
      if (Array.isArray(result)) return result
      return typeof result === 'string' ? [result] : []
    }
  })
}
