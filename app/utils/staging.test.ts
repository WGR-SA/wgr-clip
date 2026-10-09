import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { MediaKind, ToastSpec } from '~/types/job'
import { createStaging, initialStagingState, type StagingDeps } from './staging'

function kindOf(path: string): MediaKind {
  if (/\.(jpe?g|heic|png)$/i.test(path)) return 'image'
  if (/\.(mp3|wav)$/i.test(path)) return 'audio'
  return 'video'
}

function harness(overrides: Partial<StagingDeps> = {}) {
  const toasts: ToastSpec[] = []
  let n = 0
  const deps: StagingDeps = {
    expandPaths: async paths => paths,
    detectKind: kindOf,
    toast: t => void toasts.push(t),
    newUid: () => `u${++n}`,
    ...overrides
  }
  const state = ref(initialStagingState())
  return { staging: createStaging(state, deps), state, toasts }
}

describe('createStaging add', () => {
  it('stages every expanded file with its detected kind', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.mov', '/d/c.mp3'] })
    await h.staging.add(['/d'])
    expect(h.staging.items.value.map(i => [i.input, i.kind])).toEqual([
      ['/d/a.jpg', 'image'],
      ['/d/b.mov', 'video'],
      ['/d/c.mp3', 'audio']
    ])
    expect(h.staging.count.value).toBe(3)
    expect(h.staging.kinds.value).toEqual(new Set(['image', 'video', 'audio']))
  })

  it('dedupes within a single drop', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/a.jpg'] })
    await h.staging.add(['/d'])
    expect(h.staging.count.value).toBe(1)
  })

  it('resolves with the newly staged inputs, and an empty array once nothing new is staged', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.mov'] })
    expect(await h.staging.add(['/d'])).toEqual(['/d/a.jpg', '/d/b.mov'])
    expect(await h.staging.add(['/d'])).toEqual([]) // fully deduped

    const rejecting = harness({ expandPaths: async () => [] })
    expect(await rejecting.staging.add(['/d/notes.txt'])).toEqual([]) // nothing supported
  })

  // Review Focus 1
  it('dedupes against files staged by an earlier drop', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    await h.staging.add(['/d/a.jpg', '/d/b.jpg'])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/a.jpg', '/d/b.jpg'])
  })

  // Review Focus 2
  it('a re-dropped file keeps the crop it already carries', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 50, height: 50 })
    await h.staging.add(['/d/a.jpg'])
    expect(h.staging.count.value).toBe(1)
    expect(h.staging.items.value[0]!.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(h.staging.items.value[0]!.cropPx).toEqual({ width: 50, height: 50 })
  })

  it('toasts iCloud placeholders and stages the rest of the same drop', async () => {
    const h = harness({ expandPaths: async paths => paths })
    await h.staging.add(['/d/.photo.jpg.icloud', '/d/real.jpg'])
    expect(h.toasts[0]?.title).toBe('Fichier iCloud non téléchargé')
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/real.jpg'])
  })

  it('toasts and stages nothing when expansion finds no supported file', async () => {
    const h = harness({ expandPaths: async () => [] })
    await h.staging.add(['/d/notes.txt'])
    expect(h.toasts[0]?.title).toBe('Aucun fichier supporté')
    expect(h.toasts[0]?.description).toContain('notes.txt')
    expect(h.staging.count.value).toBe(0)
  })

  it('toasts and keeps the already staged items when expansion throws', async () => {
    let calls = 0
    const h = harness({
      expandPaths: async (paths) => {
        calls += 1
        if (calls > 1) throw new Error('EACCES')
        return paths
      }
    })
    await h.staging.add(['/d/a.jpg'])
    await h.staging.add(['/d/b.jpg'])
    expect(h.toasts.map(t => t.title)).toEqual(['Erreur de lecture du drop'])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/a.jpg'])
  })
})

describe('createStaging crop', () => {
  it('writes rect and cropPx on the matching item and leaves siblings alone', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.setCrop('/d/b.jpg', { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, { width: 800, height: 800 })
    expect(h.staging.items.value[0]!.crop).toBeNull()
    expect(h.staging.items.value[1]!.crop).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(h.staging.items.value[1]!.cropPx).toEqual({ width: 800, height: 800 })
  })

  // Review Focus 3
  it('setCrop for an input that is no longer staged is a no-op', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    h.staging.remove(h.staging.items.value[0]!.uid)
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 50, height: 50 })
    expect(h.staging.count.value).toBe(0)
  })

  it('uncroppedImages lists only images still missing a crop', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg', '/d/c.mov'] })
    await h.staging.add(['/d'])
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 1, h: 1 }, { width: 10, height: 10 })
    expect(h.staging.uncroppedImages.value).toEqual(['/d/b.jpg'])
  })
})

describe('createStaging remove and clear', () => {
  it('removes one item by uid', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.remove('u1')
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/b.jpg'])
  })

  it('clear with no argument empties everything', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.clear()
    expect(h.staging.count.value).toBe(0)
  })

  it('clear with uids keeps the items it was not given', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg', '/d/c.jpg'] })
    await h.staging.add(['/d'])
    h.staging.clear(['u1', 'u3'])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/b.jpg'])
  })

  it('clear with an empty array keeps every item staged', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.clear([])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/a.jpg', '/d/b.jpg'])
  })
})
