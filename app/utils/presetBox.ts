import type { CustomParams, Preset } from '~/types/job'

// Mirrors preset.rs::image_args's preset→box match. Duplicated here rather
// than asked from Rust because the crop editor's size readout updates live
// while dragging and cannot afford an IPC call per pointer move.
export function imageBoxFor(preset: Preset, custom: CustomParams | null): { maxW: number, maxH: number } {
  switch (preset) {
    case 'web1080p': return { maxW: 2000, maxH: 2000 }
    case '4k': return { maxW: 4000, maxH: 4000 }
    case 'source': return { maxW: 0, maxH: 0 }
    case 'custom': return custom ? { maxW: custom.image_max_width, maxH: custom.image_max_height } : { maxW: 0, maxH: 0 }
  }
}
