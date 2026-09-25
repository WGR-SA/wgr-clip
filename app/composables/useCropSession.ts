import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { CropRect, MediaSize } from '~/types/job'
import { IMAGE_EXTS, detectKind, toastIcloudStubs } from '~/composables/useTranscodeQueue'
import { splitIcloudStubs } from '~/utils/icloud'
import { applyRatio, initialRect } from '~/utils/cropGeometry'
import { basename } from '~/utils/format'

export interface CropCurrent {
  input: string
  previewUrl: string
  rect: CropRect
  sourceW: number
  sourceH: number
}

interface CropState {
  pending: string[]
  current: CropCurrent | null
  ratio: number | null
  loading: boolean
  index: number
  total: number
}

export function useCropSession() {
  const state = useState<CropState>('wgr-clip-crop', () => ({
    pending: [],
    current: null,
    ratio: null,
    loading: false,
    index: 0,
    total: 0
  }))
  const queue = useTranscodeQueue()

  async function open(rawPaths: string[]) {
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) toastIcloudStubs(split.stubs)
    if (split.paths.length === 0) return

    const expanded = await invoke<string[]>('expand_paths', { paths: split.paths })
    if (expanded.length === 0) {
      useToast().add({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : images courantes. Reçu : ${split.paths.map(basename).join(', ')}`,
        color: 'warning'
      })
      return
    }
    const images = expanded.filter(p => detectKind(p) === 'image')
    const rejected = expanded.filter(p => detectKind(p) !== 'image')
    if (rejected.length > 0) {
      useToast().add({
        title: 'Images seulement',
        description: `Le recadrage ne prend que des images. Ignoré : ${rejected.map(basename).join(', ')}`,
        color: 'warning'
      })
    }
    if (images.length === 0) return

    state.value.pending = [...state.value.pending, ...images]
    state.value.total += images.length
    if (!state.value.current && !state.value.loading) await loadNext()
  }

  async function pickImages() {
    const result = await openDialog({
      multiple: true,
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTS] }]
    })
    if (Array.isArray(result) && result.length > 0) await open(result)
    else if (typeof result === 'string') await open([result])
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
    try {
      const [buf, size] = await Promise.all([
        invoke<ArrayBuffer>('render_crop_preview', { input }),
        invoke<MediaSize>('probe_media_size', { input })
      ])
      const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }))
      const aspect = size.width / size.height
      state.value.current = {
        input,
        previewUrl,
        rect: initialRect(state.value.ratio, aspect),
        sourceW: size.width,
        sourceH: size.height
      }
      state.value.loading = false
    } catch (e) {
      console.error('[crop] preview failed', input, e)
      useToast().add({
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
    if (c) URL.revokeObjectURL(c.previewUrl)
    state.value.current = null
  }

  function reset() {
    releaseCurrent()
    state.value.pending = []
    state.value.index = 0
    state.value.total = 0
    state.value.loading = false
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
    if (!c) return
    await queue.addCroppedInput(c.input, c.rect)
    releaseCurrent()
    await loadNext()
  }

  async function skip() {
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
    pickImages,
    setRect,
    setRatio,
    confirm,
    skip,
    close
  }
}
