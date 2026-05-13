import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification'

/**
 * Fires a system notification each time the queue transitions from "busy"
 * (active or pending jobs) back to "idle" with at least one completed job.
 * Permission is requested lazily on the first transition.
 */
export function useBatchNotification () {
  const queue = useTranscodeQueue()

  let lastDoneAtIdle = 0
  let permissionAsked = false

  // Snapshot the current done count so the first run doesn't fire on stale state.
  let baselineDone = queue.counts.value.done

  watchEffect(() => {
    const c = queue.counts.value
    const busy = c.active + c.pending
    if (busy > 0) {
      // Re-baseline so the next idle transition only counts jobs from this batch.
      baselineDone = c.done
      return
    }
    // Idle: c.done === baselineDone means nothing finished since last batch.
    const finishedSinceLast = c.done - baselineDone
    if (finishedSinceLast > 0 && c.done !== lastDoneAtIdle) {
      lastDoneAtIdle = c.done
      void notify(finishedSinceLast, c.error)
    }
  })

  async function notify (count: number, errors: number) {
    try {
      let granted = await isPermissionGranted()
      if (!granted && !permissionAsked) {
        permissionAsked = true
        const r = await requestPermission()
        granted = r === 'granted'
      }
      if (!granted) return
      const title = errors > 0 ? 'wgr-clip · terminé avec erreurs' : 'wgr-clip · terminé'
      const body = errors > 0
        ? `${count} fichier(s) convertis · ${errors} erreur(s)`
        : `${count} fichier(s) convertis`
      sendNotification({ title, body })
    } catch (e) {
      console.warn('[notification] failed', e)
    }
  }
}
