import { Store } from '@tauri-apps/plugin-store'
import type { CustomParams, Preset } from '~/types/job'

const STORE_FILE = 'settings.json'

interface PersistedSettings {
  videoPreset: Preset
  imagePreset: Preset
  audioPreset: Preset
  outputDir: string | null
  custom: CustomParams
}

let storePromise: Promise<Store> | null = null

function getStore (): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE)
  return storePromise
}

export async function loadSettings (): Promise<Partial<PersistedSettings>> {
  try {
    const store = await getStore()
    const out: Partial<PersistedSettings> = {}
    for (const k of ['videoPreset', 'imagePreset', 'audioPreset', 'outputDir', 'custom'] as const) {
      const v = await store.get(k)
      if (v !== undefined && v !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(out as any)[k] = v
      }
    }
    return out
  } catch (e) {
    console.warn('[settings] load failed', e)
    return {}
  }
}

export async function saveSettings (patch: Partial<PersistedSettings>): Promise<void> {
  try {
    const store = await getStore()
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      await store.set(k, v as never)
    }
    await store.save()
  } catch (e) {
    console.warn('[settings] save failed', e)
  }
}
