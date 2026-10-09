import type { MediaKind } from '~/types/job'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mts', 'm2ts', 'ts', '3gp']
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif']

export const ALL_MEDIA_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS]

export const KIND_ICON: Record<MediaKind, string> = {
  video: 'i-lucide-film',
  image: 'i-lucide-image',
  audio: 'i-lucide-music'
}

export function detectKind(path: string): MediaKind {
  const m = path.toLowerCase().match(/\.([^./\\]+)$/)
  const ext = (m && m[1]) ? m[1] : ''
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  return 'video'
}
