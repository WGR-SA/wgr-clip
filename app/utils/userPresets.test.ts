import { describe, expect, it } from 'vitest'
import type { CustomParams } from '~/types/job'
import {
  describeUserPreset,
  isBuiltinPreset,
  mergeUserPresets,
  parseUserPresetFile,
  toCustomParams,
  userIdFromSelection,
  type UserPreset
} from './userPresets'

const BASE: CustomParams = {
  video_max_width: 0,
  video_max_height: 1080,
  video_crf: 22,
  video_audio_kbps: 128,
  image_max_width: 2000,
  image_max_height: 2000,
  image_quality: 85,
  audio_kbps: 192
}

const VALID_FILE = JSON.stringify({
  presets: [
    { id: 'shop-800', kind: 'image', name: 'Shop 800px', max_width: 800, max_height: 800, quality: 82 },
    { id: 'hero-1920', kind: 'video', name: 'Hero 1920', max_width: 1920, crf: 24, audio_kbps: 128 },
    { id: 'podcast', kind: 'audio', name: 'Podcast 96k', kbps: 96 }
  ]
})

function parseOk(text: string): UserPreset[] {
  const result = parseUserPresetFile(text)
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`)
  return result.presets
}

describe('parseUserPresetFile', () => {
  it('parses one preset per kind and keeps explicit ids', () => {
    const presets = parseOk(VALID_FILE)
    expect(presets.map(p => p.id)).toEqual(['shop-800', 'hero-1920', 'podcast'])
    expect(presets.map(p => p.kind)).toEqual(['image', 'video', 'audio'])
  })

  it('treats an absent dimension as free (0)', () => {
    const [, hero] = parseOk(VALID_FILE)
    expect(hero).toMatchObject({ kind: 'video', max_width: 1920, max_height: 0 })
  })

  it('derives a slug id from the name when id is absent', () => {
    const [preset] = parseOk(JSON.stringify({
      presets: [{ kind: 'image', name: 'Héro Été 2026 !', max_width: 1200 }]
    }))
    expect(preset?.id).toBe('hero-ete-2026')
  })

  it('fills quality knobs with sensible defaults when absent', () => {
    const [img, vid, aud] = parseOk(JSON.stringify({
      presets: [
        { kind: 'image', name: 'a', max_width: 100 },
        { kind: 'video', name: 'b', max_height: 720 },
        { kind: 'audio', name: 'c' }
      ]
    }))
    expect(img).toMatchObject({ quality: 85 })
    expect(vid).toMatchObject({ crf: 22, audio_kbps: 128 })
    expect(aud).toMatchObject({ kbps: 128 })
  })

  it('rejects an unknown kind and points at the offending preset', () => {
    const result = parseUserPresetFile(JSON.stringify({
      presets: [{ kind: 'pdf', name: 'Doc' }]
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('presets[0].kind')
  })

  it('rejects a JPEG quality above 100', () => {
    const result = parseUserPresetFile(JSON.stringify({
      presets: [{ kind: 'image', name: 'Too good', quality: 150 }]
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('quality')
  })

  it('rejects an id with spaces or uppercase', () => {
    const result = parseUserPresetFile(JSON.stringify({
      presets: [{ id: 'Shop 800', kind: 'image', name: 'Shop' }]
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects malformed JSON without throwing', () => {
    const result = parseUserPresetFile('{ "presets": [ oops')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/JSON/i)
  })

  it('rejects a file with no presets', () => {
    expect(parseUserPresetFile(JSON.stringify({ presets: [] })).ok).toBe(false)
  })
})

describe('toCustomParams', () => {
  it('maps an image preset onto the image fields only', () => {
    const preset: UserPreset = { id: 'shop-800', kind: 'image', name: 'Shop', max_width: 800, max_height: 600, quality: 82 }
    expect(toCustomParams(preset, BASE)).toEqual({
      ...BASE,
      image_max_width: 800,
      image_max_height: 600,
      image_quality: 82
    })
  })

  it('maps a video preset onto the video fields only', () => {
    const preset: UserPreset = { id: 'hero', kind: 'video', name: 'Hero', max_width: 1920, max_height: 0, crf: 24, audio_kbps: 96 }
    expect(toCustomParams(preset, BASE)).toEqual({
      ...BASE,
      video_max_width: 1920,
      video_max_height: 0,
      video_crf: 24,
      video_audio_kbps: 96
    })
  })

  it('maps an audio preset onto the audio bitrate only', () => {
    const preset: UserPreset = { id: 'podcast', kind: 'audio', name: 'Podcast', kbps: 96 }
    expect(toCustomParams(preset, BASE)).toEqual({ ...BASE, audio_kbps: 96 })
  })
})

describe('mergeUserPresets', () => {
  const a: UserPreset = { id: 'a', kind: 'audio', name: 'A', kbps: 96 }
  const b: UserPreset = { id: 'b', kind: 'audio', name: 'B', kbps: 128 }

  it('replaces a preset with the same id in place and appends new ones', () => {
    const b2: UserPreset = { ...b, name: 'B v2', kbps: 192 }
    const c: UserPreset = { id: 'c', kind: 'audio', name: 'C', kbps: 64 }
    expect(mergeUserPresets([a, b], [b2, c])).toEqual([a, b2, c])
  })

  it('keeps the incoming preset when a file repeats an id', () => {
    const a2: UserPreset = { ...a, kbps: 320 }
    expect(mergeUserPresets([], [a, a2])).toEqual([a2])
  })
})

describe('userIdFromSelection', () => {
  it('extracts the id from a user selection', () => {
    expect(userIdFromSelection('user:shop-800')).toBe('shop-800')
  })

  it('returns null for a built-in preset', () => {
    expect(userIdFromSelection('custom')).toBeNull()
    expect(userIdFromSelection('source')).toBeNull()
  })
})

describe('isBuiltinPreset', () => {
  it('is true for the four built-in presets and false for user selections', () => {
    expect(isBuiltinPreset('source')).toBe(true)
    expect(isBuiltinPreset('custom')).toBe(true)
    expect(isBuiltinPreset('user:shop-800')).toBe(false)
  })
})

describe('describeUserPreset', () => {
  it('describes an image box with both limits', () => {
    expect(describeUserPreset({ id: 'a', kind: 'image', name: 'A', max_width: 800, max_height: 800, quality: 82 }))
      .toBe('≤ 800×800 px · JPEG q82')
  })

  it('describes a single free axis in words', () => {
    expect(describeUserPreset({ id: 'a', kind: 'image', name: 'A', max_width: 1200, max_height: 0, quality: 85 }))
      .toBe('≤ 1200 px de large · JPEG q85')
    expect(describeUserPreset({ id: 'a', kind: 'video', name: 'A', max_width: 0, max_height: 720, crf: 26, audio_kbps: 96 }))
      .toBe('≤ 720 px de haut · CRF 26 · AAC 96k')
  })

  it('says so when no dimension limit applies', () => {
    expect(describeUserPreset({ id: 'a', kind: 'video', name: 'A', max_width: 0, max_height: 0, crf: 24, audio_kbps: 128 }))
      .toBe('Dimensions d\'origine · CRF 24 · AAC 128k')
  })

  it('describes an audio preset by its bitrate', () => {
    expect(describeUserPreset({ id: 'a', kind: 'audio', name: 'A', kbps: 96 })).toBe('MP3 96k')
  })
})
