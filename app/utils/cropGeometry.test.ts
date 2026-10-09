import { describe, expect, it } from 'vitest'
import type { CropRect } from '~/types/job'
import { MIN_SIZE, applyRatio, cropPixelSize, fitInsideBox, initialRect, moveRect, orientSourceSize, resizeRect } from './cropGeometry'

function pxRatio(r: CropRect, aspect: number): number {
  return (r.w * aspect) / r.h
}

function expectRect(r: CropRect, expected: CropRect) {
  expect(r.x).toBeCloseTo(expected.x, 6)
  expect(r.y).toBeCloseTo(expected.y, 6)
  expect(r.w).toBeCloseTo(expected.w, 6)
  expect(r.h).toBeCloseTo(expected.h, 6)
}

function expectInside(r: CropRect) {
  expect(r.x).toBeGreaterThanOrEqual(0)
  expect(r.y).toBeGreaterThanOrEqual(0)
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9)
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9)
  expect(r.w).toBeGreaterThanOrEqual(MIN_SIZE - 1e-9)
  expect(r.h).toBeGreaterThanOrEqual(MIN_SIZE - 1e-9)
}

describe('initialRect', () => {
  it('free: centered box covering 80%', () => {
    expectRect(initialRect(null, 1.5), { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
  })

  it('locked 1:1 on a 3:2 image: full height, centered square', () => {
    const r = initialRect(1, 1.5)
    expectRect(r, { x: 1 / 6, y: 0, w: 2 / 3, h: 1 })
    expect(pxRatio(r, 1.5)).toBeCloseTo(1, 6)
  })
})

describe('moveRect', () => {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }

  it('translates', () => {
    expectRect(moveRect(base, 0.05, -0.05), { x: 0.15, y: 0.05, w: 0.8, h: 0.8 })
  })

  it('clamps to the image edges', () => {
    expectRect(moveRect(base, 0.5, -0.5), { x: 0.2, y: 0, w: 0.8, h: 0.8 })
  })
})

describe('resizeRect free', () => {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }

  it('se grows right and bottom', () => {
    expectRect(resizeRect(base, 'se', 0.1, 0.1, null, 1), { x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
  })

  it('nw moves the left and top edges', () => {
    expectRect(resizeRect(base, 'nw', -0.05, -0.05, null, 1), { x: 0.05, y: 0.05, w: 0.55, h: 0.55 })
  })

  it('e clamps at the right edge', () => {
    expectRect(resizeRect(base, 'e', 0.9, 0, null, 1), { x: 0.1, y: 0.1, w: 0.9, h: 0.5 })
  })

  it('s clamps at the bottom edge', () => {
    expectRect(resizeRect(base, 's', 0, 0.9, null, 1), { x: 0.1, y: 0.1, w: 0.5, h: 0.9 })
  })

  it('w dragged past the right edge stops at MIN_SIZE', () => {
    expectRect(resizeRect(base, 'w', 0.6, 0, null, 1), { x: 0.6 - MIN_SIZE, y: 0.1, w: MIN_SIZE, h: 0.5 })
  })

  it('n dragged past the bottom edge stops at MIN_SIZE', () => {
    expectRect(resizeRect(base, 'n', 0, 0.9, null, 1), { x: 0.1, y: 0.6 - MIN_SIZE, w: 0.5, h: MIN_SIZE })
  })
})

describe('resizeRect locked', () => {
  it('se on a square image keeps 1:1 and follows the horizontal drag', () => {
    expectRect(resizeRect({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, 'se', 0.2, 0, 1, 1), { x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
  })

  it('se caps the derived height at the bottom edge and shrinks the width', () => {
    expectRect(resizeRect({ x: 0.1, y: 0.5, w: 0.4, h: 0.4 }, 'se', 0.5, 0, 1, 1), { x: 0.1, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('nw anchors on the bottom-right corner', () => {
    expectRect(resizeRect({ x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, 'nw', -0.2, 0, 1, 1), { x: 0.3, y: 0.3, w: 0.5, h: 0.5 })
  })

  it('e keeps the vertical center', () => {
    expectRect(resizeRect({ x: 0.2, y: 0.3, w: 0.4, h: 0.4 }, 'e', 0.2, 0, 1, 1), { x: 0.2, y: 0.2, w: 0.6, h: 0.6 })
  })

  it('n keeps the horizontal center with a 2:1 lock', () => {
    expectRect(resizeRect({ x: 0.3, y: 0.5, w: 0.4, h: 0.2 }, 'n', 0, -0.1, 2, 1), { x: 0.2, y: 0.4, w: 0.6, h: 0.3 })
  })

  it('panorama (aspect 4) with a 9:16 lock stays inside and keeps the ratio', () => {
    const aspect = 4
    const start = initialRect(9 / 16, aspect)
    expectInside(start)
    expect(pxRatio(start, aspect)).toBeCloseTo(9 / 16, 6)
    const r = resizeRect(start, 'se', 0.3, 0.3, 9 / 16, aspect)
    expectInside(r)
    expect(pxRatio(r, aspect)).toBeCloseTo(9 / 16, 6)
  })
})

describe('applyRatio', () => {
  it('keeps center and width, derives height', () => {
    expectRect(applyRatio({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 16 / 9, 1), { x: 0.1, y: 0.275, w: 0.8, h: 0.45 })
  })

  it('shrinks the width when the derived height overflows', () => {
    expectRect(applyRatio({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 9 / 16, 1), { x: 0.21875, y: 0, w: 0.5625, h: 1 })
  })
})

describe('orientSourceSize', () => {
  it('keeps ffprobe dimensions when the preview has the same orientation', () => {
    expect(orientSourceSize({ width: 4032, height: 3024 }, { width: 1200, height: 900 })).toEqual({ width: 4032, height: 3024 })
  })

  it('swaps them when the decoded preview is rotated 90 degrees', () => {
    expect(orientSourceSize({ width: 4032, height: 3024 }, { width: 900, height: 1200 })).toEqual({ width: 3024, height: 4032 })
    expect(orientSourceSize({ width: 3024, height: 4032 }, { width: 1200, height: 900 })).toEqual({ width: 4032, height: 3024 })
  })

  it('leaves a square source alone', () => {
    expect(orientSourceSize({ width: 2000, height: 2000 }, { width: 1200, height: 1200 })).toEqual({ width: 2000, height: 2000 })
  })
})

describe('cropPixelSize', () => {
  it('multiplies the fractional rect by the source size and rounds', () => {
    expect(cropPixelSize({ x: 0, y: 0, w: 0.5, h: 0.25 }, 4000, 3000)).toEqual({ width: 2000, height: 750 })
  })

  it('rounds to the nearest pixel rather than truncating', () => {
    expect(cropPixelSize({ x: 0, y: 0, w: 1 / 3, h: 1 / 3 }, 100, 100)).toEqual({ width: 33, height: 33 })
    expect(cropPixelSize({ x: 0, y: 0, w: 0.666, h: 0.666 }, 100, 100)).toEqual({ width: 67, height: 67 })
  })

  it('never reports a zero dimension for a non-empty rect', () => {
    const size = cropPixelSize({ x: 0, y: 0, w: 0.001, h: 0.001 }, 100, 100)
    expect(size.width).toBeGreaterThanOrEqual(1)
    expect(size.height).toBeGreaterThanOrEqual(1)
  })
})

// Fixtures below are measured against the real ffmpeg sidecar (crop 1512×1008
// out of a 4032×3024 source, then each box), not inferred from the formula —
// see preset.rs::fit_filter for the filter they mirror.
describe('fitInsideBox', () => {
  it('no box (Original preset emits no scale filter): size passes through unchanged', () => {
    expect(fitInsideBox({ width: 1512, height: 1008 }, 0, 0)).toEqual({ width: 1512, height: 1008 })
  })

  it('box bigger than the crop on both axes: never upscales', () => {
    expect(fitInsideBox({ width: 1512, height: 1008 }, 2000, 2000)).toEqual({ width: 1512, height: 1008 })
    expect(fitInsideBox({ width: 1512, height: 1008 }, 4000, 4000)).toEqual({ width: 1512, height: 1008 })
  })

  // When neither cap binds (factor === 1, nothing actually rescales),
  // force_divisible_by=2 FLOORS both axes to even rather than rounding —
  // a distinct rule from the binding case below it. Measured against the
  // bundled ffmpeg 7.1.1 via the sidecar; round 1 of this feature missed
  // this split because its fixtures all had a binding cap.
  it.each([
    [{ width: 1000, height: 667 }, { width: 1000, height: 666 }],
    [{ width: 1001, height: 667 }, { width: 1000, height: 666 }],
    [{ width: 999, height: 667 }, { width: 998, height: 666 }],
    [{ width: 1000, height: 666 }, { width: 1000, height: 666 }] // already even: floor and round agree
  ])('floors %o into a non-binding 2000×2000 box as %o', (input, expected) => {
    expect(fitInsideBox(input, 2000, 2000)).toEqual(expected)
  })

  it('rounds the same odd height in opposite directions per branch (measured, ffmpeg 7.1.1)', () => {
    // Two-axis with no binding cap trims down to even...
    expect(fitInsideBox({ width: 1000, height: 667 }, 2000, 2000)).toEqual({ width: 1000, height: 666 })
    // ...while the single-axis `-2` form rounds the derived axis to nearest.
    expect(fitInsideBox({ width: 1000, height: 667 }, 2000, 0)).toEqual({ width: 1000, height: 668 })
  })

  it('width-only box bigger than the crop: unchanged (branch for maxH === 0)', () => {
    expect(fitInsideBox({ width: 1512, height: 1008 }, 1920, 0)).toEqual({ width: 1512, height: 1008 })
  })

  it('a crop already smaller than the box comes out unchanged', () => {
    expect(fitInsideBox({ width: 604, height: 452 }, 800, 800)).toEqual({ width: 604, height: 452 })
  })

  it('fits inside a square box, both axes constrained', () => {
    expect(fitInsideBox({ width: 1512, height: 1008 }, 800, 800)).toEqual({ width: 800, height: 534 })
  })

  // Once a cap binds on at least one axis, force_divisible_by=2 rounds to
  // the NEAREST multiple of two instead of flooring (contrast the
  // non-binding fixtures above) — verified against ffmpeg 7.1.1's actual
  // output via the sidecar.
  it.each([
    [{ width: 1000, height: 667 }, { width: 800, height: 534 }],
    [{ width: 1000, height: 669 }, { width: 800, height: 536 }],
    [{ width: 1000, height: 665 }, { width: 800, height: 532 }],
    [{ width: 1500, height: 1000 }, { width: 800, height: 534 }],
    [{ width: 1600, height: 900 }, { width: 800, height: 450 }],
    [{ width: 1000, height: 1000 }, { width: 800, height: 800 }],
    [{ width: 900, height: 1600 }, { width: 450, height: 800 }]
  ])('rounds %o into an 800×800 box as %o', (input, expected) => {
    expect(fitInsideBox(input, 800, 800)).toEqual(expected)
  })

  it('width-only branch (maxH === 0): downscales by width alone, mirrors the two-axis case where width is the binding constraint', () => {
    expect(fitInsideBox({ width: 1000, height: 667 }, 800, 0)).toEqual({ width: 800, height: 534 })
  })

  it('height-only branch (maxW === 0): downscales by height alone, mirrors the two-axis case where height is the binding constraint', () => {
    expect(fitInsideBox({ width: 900, height: 1600 }, 0, 800)).toEqual({ width: 450, height: 800 })
  })

  it('height-only branch never upscales either', () => {
    expect(fitInsideBox({ width: 1512, height: 1008 }, 0, 2000)).toEqual({ width: 1512, height: 1008 })
  })

  it('clamps a vanishing dimension to a minimum of 2, the way cropPixelSize clamps to 1', () => {
    expect(fitInsideBox({ width: 1000, height: 1 }, 1, 1000)).toEqual({ width: 2, height: 2 })
  })
})
