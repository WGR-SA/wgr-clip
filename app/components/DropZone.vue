<script setup lang="ts">
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'

const queue = useTranscodeQueue()
const isHover = ref(false)
let unlisten: UnlistenFn | null = null

onMounted(async () => {
  unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const t = event.payload.type
    if (t === 'enter' || t === 'over') {
      isHover.value = true
    } else if (t === 'leave') {
      isHover.value = false
    } else if (t === 'drop') {
      isHover.value = false
      queue.addInputs(event.payload.paths)
    }
  })
})

onBeforeUnmount(() => {
  unlisten?.()
})
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'dropzone--hover': isHover }"
    role="region"
    aria-label="Drop video files or folders here"
  >
    <div class="dropzone__content">
      <UIcon
        name="i-lucide-clapperboard"
        class="dropzone__icon"
      />
      <h2 class="dropzone__title">
        Drop your videos
      </h2>
      <p class="dropzone__hint">
        Files or folders. We'll convert each one with the selected preset.
      </p>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 220px;
  padding: 2.5rem 2rem;
  border: 2px dashed #3a3a3a;
  border-radius: 16px;
  background: #1c1c1c;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  pointer-events: none;
}

.dropzone--hover {
  border-color: var(--color-icterine-400);
  background: rgba(225, 253, 95, 0.04);
  transform: scale(1.005);
}

.dropzone__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.dropzone__icon {
  width: 3rem;
  height: 3rem;
  color: var(--color-icterine-400);
  opacity: 0.85;
}

.dropzone__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.75rem;
  letter-spacing: -0.01em;
  color: #FDF7F1;
  margin: 0;
}

.dropzone__hint {
  font-size: 0.95rem;
  color: #a8a8a8;
  margin: 0;
}
</style>
