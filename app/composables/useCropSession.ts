import { invoke } from '@tauri-apps/api/core'
import type { MediaSize } from '~/types/job'
import { detectKind } from '~/utils/mediaKind'
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
  const staging = useStaging()
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
    setCrop: staging.setCrop
  })
}
