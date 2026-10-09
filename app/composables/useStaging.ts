import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ALL_MEDIA_EXTS, detectKind } from '~/utils/mediaKind'
import { createStaging, initialStagingState, type StagingState } from '~/utils/staging'

export function useStaging() {
  const state = useState<StagingState>('wgr-clip-staging', initialStagingState)
  const toast = useToast()

  const staging = createStaging(state, {
    expandPaths: paths => invoke<string[]>('expand_paths', { paths }),
    detectKind,
    toast: spec => toast.add(spec),
    newUid: () => crypto.randomUUID()
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
