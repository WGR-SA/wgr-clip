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

function roundEven(x: number): number {
  return Math.max(2, Math.round(x / 2) * 2)
}

// ffmpeg rounds to the nearest even but never past the axis's own target, so
// an overshoot steps down a notch instead.
function capEven(x: number, target: number): number {
  const n = Math.round(x / 2) * 2
  return Math.max(2, n > target ? n - 2 : n)
}

// Mirrors preset.rs::fit_filter's four branches (the downscale-only fit a
// preset applies after the crop).
//
// Two-axis rule: nearest-even, capped at the axis's own target, where the
// target is what ffmpeg's `min(iw,W)` / `min(ih,H)` evaluate to before the
// aspect fit runs (i.e. `min(source, cap)`) — rounding up past that target
// would violate force_original_aspect_ratio=decrease's "never exceed what
// was asked for" guarantee, so ffmpeg steps back down to the next even
// number instead. This was established by measuring the bundled ffmpeg
// sidecar across 25 cases, not read off ffmpeg's source, after two simpler
// theories (plain nearest-even, then a floor/round split keyed on whether a
// cap bound) each failed on a constructed case — a 667 can round to either
// 666 or 668 depending on its target, so neither "look at the value alone"
// nor "look at whether scaling happened" explains it on its own. It is
// version-specific: `fetch:ffmpeg` pulls whatever build is current, so this
// could drift on another one. The single-axis branches below force no
// evenness at all on their explicit axis (`min(iw,W)` is passed straight
// through, odd or not) — only the derived axis rounds, via `roundEven`.
export function fitInsideBox(size: MediaSize, maxW: number, maxH: number): MediaSize {
  if (maxW === 0 && maxH === 0) return size
  if (maxH === 0) {
    const width = Math.min(size.width, maxW)
    return { width, height: roundEven(width * (size.height / size.width)) }
  }
  if (maxW === 0) {
    const height = Math.min(size.height, maxH)
    return { width: roundEven(height * (size.width / size.height)), height }
  }
  const targetW = Math.min(size.width, maxW)
  const targetH = Math.min(size.height, maxH)
  const factor = Math.min(targetW / size.width, targetH / size.height)
  return {
    width: capEven(size.width * factor, targetW),
    height: capEven(size.height * factor, targetH)
  }
}
