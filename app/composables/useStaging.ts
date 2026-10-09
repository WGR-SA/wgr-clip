import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ALL_MEDIA_EXTS, detectKind } from '~/utils/mediaKind'
import { createStaging, initialStagingState, type StagingState } from '~/utils/staging'

// The uid never leaves the renderer (not persisted, not sent over IPC), so a
// plain counter is fine — and safer than crypto.randomUUID, which is
// secure-context-gated and whose failure mode (undefined in the packaged
// app's custom scheme) would kill staging entirely on the very first drop.
let uid = 0

export function useStaging() {
  const state = useState<StagingState>('wgr-clip-staging', initialStagingState)
  const toast = useToast()

  const staging = createStaging(state, {
    expandPaths: paths => invoke<string[]>('expand_paths', { paths }),
    detectKind,
    toast: spec => toast.add(spec),
    newUid: () => `s${++uid}`
  })

  async function pickFiles() {
    const result = await openDialog({
      multiple: true,
      filters: [{ name: 'Médias', extensions: [...ALL_MEDIA_EXTS] }]
    })
    if (Array.isArray(result)) await staging.add(result)
    else if (typeof result === 'string') await staging.add([result])
  }

  return { ...staging, pickFiles }
}
