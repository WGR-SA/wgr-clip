import { describe, expect, it } from 'vitest'
import type { CustomParams } from '~/types/job'
import { imageBoxFor } from './presetBox'

const custom: CustomParams = {
  video_max_width: 0,
  video_max_height: 1080,
  video_crf: 22,
  video_audio_kbps: 128,
  image_max_width: 1234,
  image_max_height: 987,
  image_quality: 85,
  audio_kbps: 192
}

describe('imageBoxFor', () => {
  it('web1080p: 2000×2000, matching preset.rs::image_args', () => {
    expect(imageBoxFor('web1080p', null)).toEqual({ maxW: 2000, maxH: 2000 })
  })

  it('4k: 4000×4000', () => {
    expect(imageBoxFor('4k', null)).toEqual({ maxW: 4000, maxH: 4000 })
  })

  it('source: no box', () => {
    expect(imageBoxFor('source', null)).toEqual({ maxW: 0, maxH: 0 })
  })

  it('custom: the custom params image box', () => {
    expect(imageBoxFor('custom', custom)).toEqual({ maxW: 1234, maxH: 987 })
  })

  it('custom with no params resolved: no box', () => {
    expect(imageBoxFor('custom', null)).toEqual({ maxW: 0, maxH: 0 })
  })
})
