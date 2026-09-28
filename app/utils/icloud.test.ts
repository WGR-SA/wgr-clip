import { describe, expect, it } from 'vitest'
import { icloudDisplayName, splitIcloudStubs } from './icloud'

describe('splitIcloudStubs', () => {
  it('separates iCloud placeholders from real files', () => {
    const { stubs, paths } = splitIcloudStubs(['/Drive/.Elouan.wav.icloud', '/Drive/photo.JPG', '/Drive/.clip.MOV.ICLOUD'])
    expect(stubs).toEqual(['/Drive/.Elouan.wav.icloud', '/Drive/.clip.MOV.ICLOUD'])
    expect(paths).toEqual(['/Drive/photo.JPG'])
  })

  it('returns everything as paths when nothing is a stub', () => {
    expect(splitIcloudStubs(['a.jpg', 'b.png'])).toEqual({ stubs: [], paths: ['a.jpg', 'b.png'] })
  })
})

describe('icloudDisplayName', () => {
  it('recovers the original file name from a stub path', () => {
    expect(icloudDisplayName('/Drive/.Elouan.wav.icloud')).toBe('Elouan.wav')
  })

  it('handles Windows separators', () => {
    expect(icloudDisplayName('C:\\Drive\\.photo.heic.icloud')).toBe('photo.heic')
  })
})
