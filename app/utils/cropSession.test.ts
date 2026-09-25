import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { CropRect, MediaKind, MediaSize } from '~/types/job'
import { createCropSession, initialCropState, type CropSessionDeps, type ToastSpec } from './cropSession'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

interface Deferred<T> { promise: Promise<T>, resolve: (v: T) => void, reject: (e: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function kindOf(path: string): MediaKind {
  if (/\.(jpe?g|heic|png)$/i.test(path)) return 'image'
  if (/\.(mp3|wav)$/i.test(path)) return 'audio'
  return 'video'
}

function harness(overrides: Partial<CropSessionDeps> = {}) {
  const toasts: ToastSpec[] = []
  const urls: string[] = []
  const revoked: string[] = []
  const previews = new Map<string, Deferred<ArrayBuffer>>()
  const enqueued: { input: string, rect: CropRect }[] = []
  let probed: MediaSize = { width: 400, height: 300 }
  let previewSize: MediaSize = { width: 400, height: 300 }
  const deps: CropSessionDeps = {
    detectKind: kindOf,
    expandPaths: async paths => paths,
    renderPreview: (input) => {
      const d = deferred<ArrayBuffer>()
      previews.set(input, d)
      return d.promise
    },
    probeSize: async () => probed,
    toUrl: () => {
      const u = `blob:${urls.length}`
      urls.push(u)
      return u
    },
    revokeUrl: u => void revoked.push(u),
    previewSize: async () => previewSize,
    toast: t => void toasts.push(t),
    addCroppedInput: vi.fn(async (input: string, rect: CropRect) => void enqueued.push({ input, rect })),
    pickImages: async () => [],
    ...overrides
  }
  const state = ref(initialCropState())
  const session = createCropSession(state, deps)
  async function resolvePreview(input: string) {
    previews.get(input)!.resolve(new ArrayBuffer(8))
    await flush()
  }
  async function failPreview(input: string) {
    previews.get(input)!.reject(new Error('preview failed (exit 1): moov atom not found'))
    await flush()
  }
  return {
    session,
    state,
    deps,
    toasts,
    urls,
    revoked,
    enqueued,
    previews,
    resolvePreview,
    failPreview,
    setProbed: (s: MediaSize) => void (probed = s),
    setPreviewSize: (s: MediaSize) => void (previewSize = s)
  }
}

describe('createCropSession open', () => {
  it('queues the images, toasts the rest and loads the first one', async () => {
    const h = harness()
    const opening = h.session.open(['/d/a.jpg', '/d/clip.mov', '/d/b.jpg'])
    await flush()
    await h.resolvePreview('/d/a.jpg')
    await opening
    expect(h.toasts.map(t => t.title)).toEqual(['Images seulement'])
    expect(h.session.current.value?.input).toBe('/d/a.jpg')
    expect(h.session.pending.value).toEqual(['/d/b.jpg'])
    expect(h.session.index.value).toBe(1)
    expect(h.session.total.value).toBe(2)
    expect(h.session.active.value).toBe(true)
  })

  it('toasts iCloud placeholders and ignores them', async () => {
    const h = harness()
    await h.session.open(['/d/.photo.jpg.icloud'])
    expect(h.toasts[0]?.title).toBe('Fichier iCloud non téléchargé')
    expect(h.toasts[0]?.description).toContain('photo.jpg')
    expect(h.session.active.value).toBe(false)
  })
})

describe('createCropSession preview failures', () => {
  it('a broken image mid-batch toasts, advances and never leaves the spinner on', async () => {
    const h = harness()
    void h.session.open(['/d/bad.jpg', '/d/good.jpg'])
    await flush()
    await h.failPreview('/d/bad.jpg')
    expect(h.toasts.map(t => t.title)).toEqual(['Aperçu impossible'])
    expect(h.toasts[0]?.description).toBe('bad.jpg : Error: preview failed (exit 1): moov atom not found')
    expect(h.session.loading.value).toBe(true)
    await h.resolvePreview('/d/good.jpg')
    expect(h.session.loading.value).toBe(false)
    expect(h.session.current.value?.input).toBe('/d/good.jpg')
    expect(h.session.index.value).toBe(2)
    expect(h.session.total.value).toBe(2)
  })

  it('a broken last image closes the session', async () => {
    const h = harness()
    void h.session.open(['/d/bad.jpg'])
    await flush()
    await h.failPreview('/d/bad.jpg')
    expect(h.session.active.value).toBe(false)
    expect(h.session.loading.value).toBe(false)
  })
})

describe('createCropSession cancellation and re-entrancy', () => {
  it('close during a pending preview discards the late result and leaks no url', async () => {
    const h = harness()
    void h.session.open(['/d/slow.jpg'])
    await flush()
    h.session.close()
    expect(h.session.active.value).toBe(false)
    await h.resolvePreview('/d/slow.jpg')
    expect(h.session.current.value).toBeNull()
    expect(h.session.active.value).toBe(false)
    expect(h.revoked).toEqual(h.urls)
  })

  it('skip during a pending preview is ignored', async () => {
    const h = harness()
    void h.session.open(['/d/a.jpg', '/d/b.jpg'])
    await flush()
    await h.session.skip()
    expect(h.previews.has('/d/b.jpg')).toBe(false)
    await h.resolvePreview('/d/a.jpg')
    expect(h.session.current.value?.input).toBe('/d/a.jpg')
  })

  it('confirm enqueues once when called twice before the first returns', async () => {
    const gate = deferred<undefined>()
    const h = harness({ addCroppedInput: vi.fn(() => gate.promise) })
    void h.session.open(['/d/a.jpg'])
    await flush()
    await h.resolvePreview('/d/a.jpg')
    const first = h.session.confirm()
    const second = h.session.confirm()
    gate.resolve(undefined)
    await Promise.all([first, second])
    expect(h.deps.addCroppedInput).toHaveBeenCalledTimes(1)
    expect(h.session.active.value).toBe(false)
  })
})

describe('createCropSession source size and ratio', () => {
  it('follows the preview orientation when ffprobe reports unrotated dimensions', async () => {
    const h = harness()
    h.setProbed({ width: 4032, height: 3024 })
    h.setPreviewSize({ width: 900, height: 1200 })
    void h.session.open(['/d/portrait.heic'])
    await flush()
    await h.resolvePreview('/d/portrait.heic')
    expect(h.session.current.value?.sourceW).toBe(3024)
    expect(h.session.current.value?.sourceH).toBe(4032)
  })

  it('a ratio lock set before loading yields a square frame in pixels on a rotated photo', async () => {
    const h = harness()
    h.setProbed({ width: 4032, height: 3024 })
    h.setPreviewSize({ width: 900, height: 1200 })
    h.session.setRatio(1)
    void h.session.open(['/d/portrait.heic'])
    await flush()
    await h.resolvePreview('/d/portrait.heic')
    const c = h.session.current.value!
    expect((c.rect.w * c.sourceW) / (c.rect.h * c.sourceH)).toBeCloseTo(1, 6)
  })

  it('setRatio refits the current frame and confirm passes that frame on', async () => {
    const h = harness()
    void h.session.open(['/d/a.jpg'])
    await flush()
    await h.resolvePreview('/d/a.jpg')
    h.session.setRatio(16 / 9)
    const c = h.session.current.value!
    expect((c.rect.w * c.sourceW) / (c.rect.h * c.sourceH)).toBeCloseTo(16 / 9, 6)
    await h.session.confirm()
    expect(h.enqueued).toEqual([{ input: '/d/a.jpg', rect: c.rect }])
    expect(h.session.active.value).toBe(false)
    expect(h.revoked).toEqual(h.urls)
  })
})
