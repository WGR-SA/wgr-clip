import { describe, expect, it } from 'vitest'
import { pickDropTarget } from './dropHitTest'

const zones = [
  { id: 'convert', rect: { left: 0, top: 100, right: 300, bottom: 240 } },
  { id: 'crop', rect: { left: 320, top: 100, right: 620, bottom: 240 } }
]

describe('pickDropTarget', () => {
  it('returns the zone under a logical position', () => {
    expect(pickDropTarget({ x: 400, y: 150 }, 1, zones)).toBe('crop')
    expect(pickDropTarget({ x: 10, y: 150 }, 1, zones)).toBe('convert')
  })

  it('converts physical pixels to logical ones with the device pixel ratio', () => {
    // 800 physical px on a 2× display is 400 logical px: inside the crop zone.
    expect(pickDropTarget({ x: 800, y: 300 }, 2, zones)).toBe('crop')
    expect(pickDropTarget({ x: 800, y: 300 }, 1, zones)).toBeNull()
  })

  it('returns null outside every zone', () => {
    expect(pickDropTarget({ x: 310, y: 150 }, 1, zones)).toBeNull()
    expect(pickDropTarget({ x: 100, y: 20 }, 1, zones)).toBeNull()
  })

  it('treats the borders as inside', () => {
    expect(pickDropTarget({ x: 300, y: 240 }, 1, zones)).toBe('convert')
  })
})
