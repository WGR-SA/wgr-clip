import { Store } from '@tauri-apps/plugin-store'
import type { CustomParams, PresetSelection } from '~/types/job'
import type { UserPreset } from '~/utils/userPresets'

const STORE_FILE = 'settings.json'

interface PersistedSettings {
  videoPreset: PresetSelection
  imagePreset: PresetSelection
  audioPreset: PresetSelection
  outputDir: string | null
  custom: CustomParams
  userPresets: UserPreset[]
}

// Settings written before the L×H box stored the image limit as one longest side.
type StoredCustom = Partial<CustomParams> & { image_max_dim?: number }

export type LoadedSettings = Partial<Omit<PersistedSettings, 'custom'>> & { custom?: Partial<CustomParams> }

let storePromise: Promise<Store> | null = null

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE)
  return storePromise
}

function migrateCustom(stored: StoredCustom): Partial<CustomParams> {
  const { image_max_dim, ...rest } = stored
  if (image_max_dim === undefined) return rest
  return {
    ...rest,
    image_max_width: rest.image_max_width ?? image_max_dim,
    image_max_height: rest.image_max_height ?? image_max_dim
  }
}

export async function loadSettings(): Promise<LoadedSettings> {
  try {
    const store = await getStore()
    const [videoPreset, imagePreset, audioPreset, outputDir, custom, userPresets] = await Promise.all([
      store.get<PresetSelection>('videoPreset'),
      store.get<PresetSelection>('imagePreset'),
      store.get<PresetSelection>('audioPreset'),
      store.get<string | null>('outputDir'),
      store.get<StoredCustom>('custom'),
      store.get<UserPreset[]>('userPresets')
    ])
    return {
      videoPreset,
      imagePreset,
      audioPreset,
      outputDir: outputDir ?? undefined,
      custom: custom ? migrateCustom(custom) : undefined,
      userPresets
    }
  } catch (e) {
    console.warn('[settings] load failed', e)
    return {}
  }
}

export async function saveSettings(patch: Partial<PersistedSettings>): Promise<void> {
  try {
    const store = await getStore()
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      await store.set(k, v)
    }
    await store.save()
  } catch (e) {
    console.warn('[settings] save failed', e)
  }
}
