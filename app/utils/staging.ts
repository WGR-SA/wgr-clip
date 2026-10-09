import { computed, type Ref } from 'vue'
import type { CropRect, MediaKind, MediaSize, StagedItem, ToastSpec } from '~/types/job'
import { basename } from '~/utils/format'
import { icloudToast, splitIcloudStubs } from '~/utils/icloud'

export interface StagingState {
  items: StagedItem[]
}

export function initialStagingState(): StagingState {
  return { items: [] }
}

export interface StagingDeps {
  expandPaths: (paths: string[]) => Promise<string[]>
  detectKind: (path: string) => MediaKind
  toast: (spec: ToastSpec) => void
  newUid: () => string
}

export function createStaging(state: Ref<StagingState>, deps: StagingDeps) {
  async function add(rawPaths: string[]) {
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) deps.toast(icloudToast(split.stubs))
    if (split.paths.length === 0) return

    let expanded: string[]
    try {
      expanded = await deps.expandPaths(split.paths)
    } catch (e) {
      deps.toast({ title: 'Erreur de lecture du drop', description: String(e), color: 'error' })
      return
    }

    if (expanded.length === 0) {
      deps.toast({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : vidéo, image ou audio courants. Reçu : ${split.paths.map(basename).join(', ')}`,
        color: 'warning'
      })
      return
    }

    const known = new Set(state.value.items.map(i => i.input))
    const fresh: StagedItem[] = []
    for (const input of expanded) {
      if (known.has(input)) continue
      known.add(input)
      fresh.push({ uid: deps.newUid(), input, kind: deps.detectKind(input), crop: null, cropPx: null })
    }
    if (fresh.length > 0) state.value.items = [...state.value.items, ...fresh]
  }

  function setCrop(input: string, crop: CropRect, cropPx: MediaSize) {
    state.value.items = state.value.items.map(i => i.input === input ? { ...i, crop, cropPx } : i)
  }

  function remove(uid: string) {
    state.value.items = state.value.items.filter(i => i.uid !== uid)
  }

  function clear(uids?: string[]) {
    if (!uids) {
      state.value.items = []
      return
    }
    const gone = new Set(uids)
    state.value.items = state.value.items.filter(i => !gone.has(i.uid))
  }

  return {
    items: computed(() => state.value.items),
    count: computed(() => state.value.items.length),
    kinds: computed(() => new Set(state.value.items.map(i => i.kind))),
    uncroppedImages: computed(() => state.value.items.filter(i => i.kind === 'image' && i.crop === null).map(i => i.input)),
    add,
    setCrop,
    remove,
    clear
  }
}
