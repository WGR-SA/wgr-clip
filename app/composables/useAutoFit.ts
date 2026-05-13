import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'

/**
 * Auto-fit the Tauri window to the document content height.
 *
 * Tauri's `setSize` operates on the *outer* window size (titlebar + chrome),
 * while ResizeObserver gives us the *inner* content size. We measure the
 * delta once at boot (titlebar height) and apply it to every subsequent fit
 * so the visible webview ends up exactly matching the content.
 *
 * Bounds:
 * - never below the OS-enforced `minHeight` declared in tauri.conf.json
 * - never above `min(MAX_HEIGHT, screen.availHeight - 80)` so the
 *   window never grows off-screen on small displays
 */
const MAX_HEIGHT = 1100
const MIN_OUTER_HEIGHT = 440
const FIT_TIMEOUT_MS = 120
// Extra room appended to the measured content height so the footer never
// gets clipped when fonts settle a fraction of a pixel after layout.
const SAFETY_PAD_PX = 4

export function useAutoFit (target: Ref<HTMLElement | null>) {
  let appliedOuterH = 0
  let chromeDelta = 28 // sensible macOS default until first measurement
  let timer: ReturnType<typeof setTimeout> | null = null
  let observer: ResizeObserver | null = null
  let mounted = false

  function measureChromeDelta () {
    // Browser globals already report the right values inside a Tauri webview
    // and don't require any extra capability. Fall back to a sensible macOS
    // default if the numbers look bogus (e.g. fullscreen, headless tests).
    if (typeof window === 'undefined') return
    const d = window.outerHeight - window.innerHeight
    if (Number.isFinite(d) && d >= 0 && d < 200) chromeDelta = d
  }

  async function fit () {
    if (!mounted) return
    const el = target.value
    if (!el) return

    const widthLogical = Math.round(window.innerWidth)

    const contentH = Math.ceil(el.scrollHeight) + SAFETY_PAD_PX
    const cap = Math.min(MAX_HEIGHT, Math.max(MIN_OUTER_HEIGHT, (window.screen.availHeight || 1080) - 80))
    const targetOuter = Math.max(MIN_OUTER_HEIGHT, Math.min(cap, Math.ceil(contentH + chromeDelta)))

    if (Math.abs(targetOuter - appliedOuterH) < 4) return
    appliedOuterH = targetOuter
    try {
      const win = getCurrentWindow()
      await win.setSize(new LogicalSize(widthLogical, targetOuter))
    } catch (e) {
      console.warn('autoFit setSize failed', e)
    }
  }

  function schedule () {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fit, FIT_TIMEOUT_MS)
  }

  onMounted(() => {
    mounted = true
    measureChromeDelta()
    if (!target.value) return
    observer = new ResizeObserver(() => {
      measureChromeDelta()
      schedule()
    })
    observer.observe(target.value)
    // Wait for fonts so the measured height includes them, then re-fit.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => schedule()).catch(() => {})
    }
    requestAnimationFrame(() => requestAnimationFrame(schedule))
  })

  onBeforeUnmount(() => {
    mounted = false
    if (timer) clearTimeout(timer)
    observer?.disconnect()
  })
}
