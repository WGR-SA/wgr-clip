<script setup lang="ts">
import type { MediaKind, Preset } from '~/types/job'

const props = defineProps<{ kind: MediaKind }>()

const queue = useTranscodeQueue()

interface PresetOption {
  value: Preset
  label: string
  hint: string
}

const itemsByKind: Record<MediaKind, PresetOption[]> = {
  video: [
    { value: 'source', label: 'Original', hint: 'Garde la résolution d\'origine' },
    { value: 'web1080p', label: 'Web 1080p', hint: 'Cap 1920×1080, ~5 Mb/s' },
    { value: '4k', label: '4K 2160p', hint: 'Cap 3840×2160, ~25 Mb/s' },
    { value: 'custom', label: 'Personnalisé…', hint: 'Définir résolution / qualité' }
  ],
  image: [
    { value: 'source', label: 'Original', hint: 'Garde les dimensions, recompresse JPEG q92' },
    { value: 'web1080p', label: 'Web 2000px', hint: 'Cap 2000px, JPEG q85' },
    { value: '4k', label: 'HD 4000px', hint: 'Cap 4000px, JPEG q90' },
    { value: 'custom', label: 'Personnalisé…', hint: 'Définir taille / qualité' }
  ],
  audio: [
    { value: 'source', label: 'Standard 192k', hint: 'MP3 192k — qualité standard' },
    { value: 'web1080p', label: 'Web 128k', hint: 'MP3 128k — compact pour upload' },
    { value: '4k', label: 'HQ 256k', hint: 'MP3 256k — haute qualité' },
    { value: 'custom', label: 'Personnalisé…', hint: 'Définir le bitrate MP3' }
  ]
}

const items = computed(() => itemsByKind[props.kind])

const kindMeta: Record<MediaKind, { caption: string, icon: string }> = {
  video: { caption: 'Vidéo', icon: 'i-lucide-film' },
  image: { caption: 'Image', icon: 'i-lucide-image' },
  audio: { caption: 'Audio', icon: 'i-lucide-music' }
}

const currentValue = computed<Preset>(() => {
  if (props.kind === 'video') return queue.videoPreset.value
  if (props.kind === 'image') return queue.imagePreset.value
  return queue.audioPreset.value
})

const selected = computed<PresetOption>({
  get: () => items.value.find(i => i.value === currentValue.value) ?? items.value[0]!,
  set: (v) => queue.setPreset(props.kind, v.value)
})

const meta = computed(() => kindMeta[props.kind])
</script>

<template>
  <USelectMenu
    v-model="selected"
    :items="items"
    :search-input="false"
    class="preset"
    :ui="{ base: 'preset__trigger' }"
  >
    <template #default="{ modelValue }">
      <span class="preset__value">
        <UIcon
          :name="meta.icon"
          class="preset__icon"
        />
        <span class="preset__caption">{{ meta.caption }}</span>
        <strong class="preset__label">{{ modelValue.label }}</strong>
      </span>
    </template>
    <template #item="{ item }">
      <span class="preset__option">
        <strong>{{ item.label }}</strong>
        <span class="preset__hint">{{ item.hint }}</span>
      </span>
    </template>
  </USelectMenu>
</template>

<style scoped>
.preset {
  flex: 0 0 auto;
}

.preset :deep(.preset__trigger) {
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  min-height: 30px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

.preset :deep(.preset__trigger:hover) {
  border-color: #3a3a3a;
}

.preset__value {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  white-space: nowrap;
}

.preset__icon {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--color-icterine-400);
  flex-shrink: 0;
}

.preset__caption {
  color: #888;
  font-weight: 500;
}

.preset__label {
  color: #FDF7F1;
  font-weight: 700;
}

.preset__option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0.15rem 0;
}

.preset__hint {
  display: block;
  font-size: 0.72rem;
  color: #888;
  line-height: 1.3;
}
</style>
