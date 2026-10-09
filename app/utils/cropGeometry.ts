import type { CropRect, MediaSize } from '~/types/job'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_SIZE = 0.02

/** Ratios are pixel width / pixel height. */
export const RATIO_PRESETS: readonly { label: string, value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 }
]

// Fractions are not isotropic: a pixel ratio maps to fractions through the
// image's own aspect (sourceW / sourceH).
function heightForWidth(w: number, ratio: number, imageAspect: number): number {
  return (w * imageAspect) / ratio
}

function widthForHeight(h: number, ratio: number, imageAspect: number): number {
  return (h * ratio) / imageAspect
}

export function clampRect(r: CropRect): CropRect {
  const w = Math.max(MIN_SIZE, Math.min(1, r.w))
  const h = Math.max(MIN_SIZE, Math.min(1, r.h))
  const x = Math.max(0, Math.min(1 - w, r.x))
  const y = Math.max(0, Math.min(1 - h, r.y))
  return { x, y, w, h }
}

export function applyRatio(r: CropRect, ratio: number, imageAspect: number): CropRect {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let w = r.w
  let h = heightForWidth(w, ratio, imageAspect)
  if (h > 1) {
    h = 1
    w = widthForHeight(h, ratio, imageAspect)
  }
  if (h < MIN_SIZE) {
    h = MIN_SIZE
    w = widthForHeight(h, ratio, imageAspect)
  }
  if (w > 1) {
    w = 1
    h = heightForWidth(w, ratio, imageAspect)
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h })
}

export function initialRect(ratio: number | null, imageAspect: number): CropRect {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  return ratio === null ? base : applyRatio(base, ratio, imageAspect)
}

export function moveRect(r: CropRect, dx: number, dy: number): CropRect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy })
}

interface Edges { nl: number, nr: number, nt: number, nb: number }

export function resizeRect(
  r: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  imageAspect: number
): CropRect {
  const left = r.x
  const top = r.y
  const right = r.x + r.w
  const bottom = r.y + r.h
  const e: Edges = { nl: left, nr: right, nt: top, nb: bottom }
  if (handle.includes('w')) e.nl = Math.min(Math.max(0, left + dx), right - MIN_SIZE)
  if (handle.includes('e')) e.nr = Math.max(Math.min(1, right + dx), left + MIN_SIZE)
  if (handle.includes('n')) e.nt = Math.min(Math.max(0, top + dy), bottom - MIN_SIZE)
  if (handle.includes('s')) e.nb = Math.max(Math.min(1, bottom + dy), top + MIN_SIZE)
  if (ratio === null) return { x: e.nl, y: e.nt, w: e.nr - e.nl, h: e.nb - e.nt }
  return fitRatio(e, handle, ratio, imageAspect)
}

function fitRatio(e: Edges, handle: Handle, ratio: number, imageAspect: number): CropRect {
  let { nl, nr, nt, nb } = e
  if (handle === 'n' || handle === 's') {
    // Height drives, width grows symmetrically around the horizontal center.
    const cx = (nl + nr) / 2
    let h = nb - nt
    let w = widthForHeight(h, ratio, imageAspect)
    const maxW = 2 * Math.min(cx, 1 - cx)
    if (w > maxW) {
      w = maxW
      h = heightForWidth(w, ratio, imageAspect)
    }
    if (handle === 'n') nt = nb - h
    else nb = nt + h
    nl = cx - w / 2
    nr = cx + w / 2
  } else if (handle === 'e' || handle === 'w') {
    const cy = (nt + nb) / 2
    let w = nr - nl
    let h = heightForWidth(w, ratio, imageAspect)
    const maxH = 2 * Math.min(cy, 1 - cy)
    if (h > maxH) {
      h = maxH
      w = widthForHeight(h, ratio, imageAspect)
    }
    if (handle === 'w') nl = nr - w
    else nr = nl + w
    nt = cy - h / 2
    nb = cy + h / 2
  } else {
    // Corner: width drives, the handle's own vertical edge follows, the
    // opposite corner stays put.
    let w = nr - nl
    let h = heightForWidth(w, ratio, imageAspect)
    const maxH = handle.includes('n') ? nb : 1 - nt
    if (h > maxH) {
      h = maxH
      w = widthForHeight(h, ratio, imageAspect)
    }
    if (handle.includes('w')) nl = nr - w
    else nr = nl + w
    if (handle.includes('n')) nt = nb - h
    else nb = nt + h
  }
  return clampRect({ x: nl, y: nt, w: nr - nl, h: nb - nt })
}

// ffprobe reports stored (unrotated) dimensions while ffmpeg autorotates the
// preview and the encode; the preview's orientation says which way round.
export function orientSourceSize(probed: MediaSize, preview: MediaSize): MediaSize {
  const long = Math.max(probed.width, probed.height)
  const short = Math.min(probed.width, probed.height)
  return preview.width >= preview.height ? { width: long, height: short } : { width: short, height: long }
}

export function cropPixelSize(rect: CropRect, sourceW: number, sourceH: number): MediaSize {
  return {
    width: Math.max(1, Math.round(rect.w * sourceW)),
    height: Math.max(1, Math.round(rect.h * sourceH))
  }
}
