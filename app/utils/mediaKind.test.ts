import { describe, expect, it } from 'vitest'
import { ALL_MEDIA_EXTS, IMAGE_EXTS, detectKind } from './mediaKind'

describe('detectKind', () => {
  it('reads the extension case-insensitively', () => {
    expect(detectKind('/d/a.HEIC')).toBe('image')
    expect(detectKind('/d/a.MP3')).toBe('audio')
    expect(detectKind('/d/a.MoV')).toBe('video')
  })

  it('falls back to video for unknown and missing extensions', () => {
    expect(detectKind('/d/weird.xyz')).toBe('video')
    expect(detectKind('/d/noext')).toBe('video')
  })

  it('ignores dots in parent directories', () => {
    expect(detectKind('/d/v1.2/clip')).toBe('video')
    expect(detectKind('/d/v1.2/photo.jpg')).toBe('image')
  })

  it('exposes image extensions as a subset of the full media list', () => {
    expect(IMAGE_EXTS).toContain('heic')
    for (const ext of IMAGE_EXTS) expect(ALL_MEDIA_EXTS).toContain(ext)
  })
})
