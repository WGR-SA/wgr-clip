import { computed, type Ref } from 'vue'
import type { CropRect, MediaKind, MediaSize, ToastSpec } from '~/types/job'
import { applyRatio, cropPixelSize, initialRect, orientSourceSize } from '~/utils/cropGeometry'
import { icloudToast, splitIcloudStubs } from '~/utils/icloud'
import { basename } from '~/utils/format'

export interface CropCurrent {
  input: string
  previewUrl: string
  rect: CropRect
  sourceW: number
  sourceH: number
}

export interface CropState {
  pending: string[]
  current: CropCurrent | null
  ratio: number | null
  loading: boolean
  index: number
  total: number
  // Bumped by every load and by reset: a load whose gen is stale was
  // cancelled and must not touch the state.
  gen: number
}

export function initialCropState(): CropState {
  return { pending: [], current: null, ratio: null, loading: false, index: 0, total: 0, gen: 0 }
}

export interface CropSessionDeps {
  detectKind: (path: string) => MediaKind
  expandPaths: (paths: string[]) => Promise<string[]>
  renderPreview: (input: string) => Promise<ArrayBuffer>
  probeSize: (input: string) => Promise<MediaSize>
  toUrl: (bytes: ArrayBuffer) => string
  revokeUrl: (url: string) => void
  previewSize: (url: string) => Promise<MediaSize>
  toast: (spec: ToastSpec) => void
  setCrop: (input: string, rect: CropRect, cropPx: MediaSize) => void
}

export function createCropSession(state: Ref<CropState>, deps: CropSessionDeps) {
  async function open(rawPaths: string[]) {
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) deps.toast(icloudToast(split.stubs))
    if (split.paths.length === 0) return

    const expanded = await deps.expandPaths(split.paths)
    if (expanded.length === 0) {
      deps.toast({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : images courantes. Reçu : ${split.paths.map(basename).join(', ')}`,
        color: 'warning'
      })
      return
    }
    const images = expanded.filter(p => deps.detectKind(p) === 'image')
    const rejected = expanded.filter(p => deps.detectKind(p) !== 'image')
    if (rejected.length > 0) {
      deps.toast({
        title: 'Images seulement',
        description: `Reste dans la liste, mais ne sera pas recadré : ${rejected.map(basename).join(', ')}`,
        color: 'warning'
      })
    }
    if (images.length === 0) return

    state.value.pending = [...state.value.pending, ...images]
    state.value.total += images.length
    if (!state.value.current && !state.value.loading) await loadNext()
  }

  async function loadNext() {
    const input = state.value.pending[0]
    if (!input) {
      reset()
      return
    }
    state.value.pending = state.value.pending.slice(1)
    state.value.index += 1
    state.value.loading = true
    const gen = ++state.value.gen
    try {
      const [bytes, probed] = await Promise.all([deps.renderPreview(input), deps.probeSize(input)])
      if (gen !== state.value.gen) return
      const previewUrl = deps.toUrl(bytes)
      let preview: MediaSize
      try {
        preview = await deps.previewSize(previewUrl)
      } catch (e) {
        deps.revokeUrl(previewUrl)
        throw e
      }
      if (gen !== state.value.gen) {
        deps.revokeUrl(previewUrl)
        return
      }
      const size = orientSourceSize(probed, preview)
      state.value.current = {
        input,
        previewUrl,
        rect: initialRect(state.value.ratio, size.width / size.height),
        sourceW: size.width,
        sourceH: size.height
      }
      state.value.loading = false
    } catch (e) {
      if (gen !== state.value.gen) return
      console.error('[crop] preview failed', input, e)
      deps.toast({
        title: 'Aperçu impossible',
        description: `${basename(input)} : ${String(e).split('\n')[0]}`,
        color: 'error'
      })
      state.value.loading = false
      await loadNext()
    }
  }

  function releaseCurrent() {
    const c = state.value.current
    if (c) deps.revokeUrl(c.previewUrl)
    state.value.current = null
  }

  function reset() {
    releaseCurrent()
    state.value.pending = []
    state.value.index = 0
    state.value.total = 0
    state.value.loading = false
    state.value.gen += 1
  }

  function setRect(rect: CropRect) {
    const c = state.value.current
    if (c) state.value.current = { ...c, rect }
  }

  function setRatio(ratio: number | null) {
    state.value.ratio = ratio
    const c = state.value.current
    if (c && ratio !== null) {
      state.value.current = { ...c, rect: applyRatio(c.rect, ratio, c.sourceW / c.sourceH) }
    }
  }

  async function confirm() {
    const c = state.value.current
    if (!c || state.value.loading) return
    // Clearing `current` first makes a second confirm (click + Enter) a no-op;
    // `loading` keeps the editor mounted on its spinner meanwhile.
    state.value.current = null
    state.value.loading = true
    deps.setCrop(c.input, c.rect, cropPixelSize(c.rect, c.sourceW, c.sourceH))
    deps.revokeUrl(c.previewUrl)
    await loadNext()
  }

  async function skip() {
    if (state.value.loading) return
    releaseCurrent()
    await loadNext()
  }

  function close() {
    reset()
  }

  return {
    current: computed(() => state.value.current),
    pending: computed(() => state.value.pending),
    ratio: computed(() => state.value.ratio),
    loading: computed(() => state.value.loading),
    active: computed(() => state.value.current !== null || state.value.loading),
    index: computed(() => state.value.index),
    total: computed(() => state.value.total),
    open,
    setRect,
    setRatio,
    confirm,
    skip,
    close
  }
}
