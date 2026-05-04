<script setup lang="ts">
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'

const queue = useTranscodeQueue()
const isHover = ref(false)
let unlisten: UnlistenFn | null = null

onMounted(async () => {
  console.log('[DropZone] attaching drag/drop listener')
  try {
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      console.log('[DropZone] event:', event.payload.type, event.payload)
      const t = event.payload.type
      if (t === 'enter' || t === 'over') {
        isHover.value = true
      } else if (t === 'leave') {
        isHover.value = false
      } else if (t === 'drop') {
        isHover.value = false
        const paths = (event.payload as { paths?: string[] }).paths ?? []
        console.log('[DropZone] dropped paths:', paths)
        if (paths.length === 0) {
          useToast().add({
            title: 'Drop vide',
            description: 'Aucun chemin de fichier reçu — essayez un autre dossier.',
            color: 'warning'
          })
          return
        }
        queue.addInputs(paths).catch((e) => {
          console.error('[DropZone] addInputs failed', e)
          useToast().add({
            title: 'Erreur',
            description: String(e),
            color: 'error'
          })
        })
      }
    })
    console.log('[DropZone] listener attached')
  } catch (e) {
    console.error('[DropZone] failed to attach listener', e)
    useToast().add({
      title: 'Drag-drop indisponible',
      description: 'Le listener Tauri n\'a pas pu être attaché. Essayez de relancer l\'app.',
      color: 'error'
    })
  }
})

onBeforeUnmount(() => {
  unlisten?.()
  unlisten = null
})
</script>

<template>
  <button
    type="button"
    class="dropzone"
    :class="{ 'dropzone--hover': isHover }"
    aria-label="Déposez vos fichiers ou cliquez pour parcourir"
    @click="queue.pickInputFiles()"
  >
    <div class="dropzone__content">
      <UIcon
        name="i-lucide-arrow-down-to-line"
        class="dropzone__icon"
      />
      <h2 class="dropzone__title">
        Déposez vos fichiers ou cliquez pour parcourir
      </h2>
      <p class="dropzone__hint">
        Vidéos, images, audio. Fichiers ou dossiers. Détection auto, conversion immédiate.
      </p>
    </div>
  </button>
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
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.dropzone:hover {
  border-color: #525252;
  background: #1f1f1f;
}

.dropzone:focus-visible {
  outline: 2px solid var(--color-icterine-400);
  outline-offset: 2px;
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
