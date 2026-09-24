import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { saveSettings } from '~/composables/useSettingsStore'
import type { MediaKind } from '~/types/job'
import { mergeUserPresets, parseUserPresetFile, type UserPreset } from '~/utils/userPresets'

interface UserPresetsState {
  presets: UserPreset[]
  managerOpen: boolean
}

export function useUserPresets() {
  const state = useState<UserPresetsState>('wgr-clip-user-presets', () => ({
    presets: [],
    managerOpen: false
  }))

  function hydrate(presets: UserPreset[]) {
    state.value.presets = presets
  }

  function forKind(kind: MediaKind): UserPreset[] {
    return state.value.presets.filter(p => p.kind === kind)
  }

  function byId(id: string): UserPreset | undefined {
    return state.value.presets.find(p => p.id === id)
  }

  function persist() {
    void saveSettings({ userPresets: state.value.presets })
  }

  async function importFromFile(): Promise<void> {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Presets JSON', extensions: ['json'] }]
    })
    if (typeof picked !== 'string') return

    let text: string
    try {
      text = await readTextFile(picked)
    } catch (err) {
      useToast().add({ title: 'Lecture du fichier impossible', description: String(err), color: 'error' })
      return
    }

    const result = parseUserPresetFile(text)
    if (!result.ok) {
      useToast().add({
        title: 'Fichier de presets invalide',
        description: result.message,
        color: 'error',
        duration: 8000
      })
      return
    }

    state.value.presets = mergeUserPresets(state.value.presets, result.presets)
    persist()
    const n = result.presets.length
    useToast().add({
      title: n > 1 ? `${n} presets importés` : 'Preset importé',
      description: result.presets.map(p => p.name).join(', '),
      color: 'success'
    })
  }

  function remove(id: string) {
    state.value.presets = state.value.presets.filter(p => p.id !== id)
    persist()
  }

  return {
    presets: computed(() => state.value.presets),
    managerOpen: computed({
      get: () => state.value.managerOpen,
      set: (v: boolean) => {
        state.value.managerOpen = v
      }
    }),
    hydrate,
    forKind,
    byId,
    importFromFile,
    remove,
    openManager: () => {
      state.value.managerOpen = true
    }
  }
}
