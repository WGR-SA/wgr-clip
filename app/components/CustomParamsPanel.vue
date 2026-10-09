<script setup lang="ts">
import type { CustomParams } from '~/types/job'

const queue = useTranscodeQueue()
const staging = useStaging()

const showVideo = computed(() => staging.kinds.value.has('video') && queue.videoPreset.value === 'custom')
const showImage = computed(() => staging.kinds.value.has('image') && queue.imagePreset.value === 'custom')
const showAudio = computed(() => staging.kinds.value.has('audio') && queue.audioPreset.value === 'custom')
const visible = computed(() => showVideo.value || showImage.value || showAudio.value)

function field(key: keyof CustomParams, min: number, max: number) {
  return computed({
    get: () => queue.custom.value[key],
    set: (v: number) => queue.patchCustom({ [key]: clampInt(v, min, max) })
  })
}

const videoMaxW = field('video_max_width', 0, 7680)
const videoMaxH = field('video_max_height', 0, 4320)
const videoCrf = field('video_crf', 15, 32)
const videoAudioKbps = field('video_audio_kbps', 32, 320)

const imageMaxW = field('image_max_width', 0, 8000)
const imageMaxH = field('image_max_height', 0, 8000)
const imageQuality = field('image_quality', 1, 100)

const audioKbps = field('audio_kbps', 32, 320)

function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.round(n) : min
  return Math.max(min, Math.min(max, x))
}
</script>

<template>
  <section
    v-if="visible"
    class="custom"
  >
    <header class="custom__head">
      <UIcon
        name="i-lucide-sliders-horizontal"
        class="custom__head-icon"
      />
      <span>Réglages personnalisés</span>
    </header>

    <div
      v-if="showVideo"
      class="custom__group"
    >
      <span class="custom__group-label">Vidéo</span>
      <div class="custom__fields">
        <label class="custom__field">
          <span>Largeur max (px)</span>
          <UInput
            v-model.number="videoMaxW"
            type="number"
            min="0"
            max="7680"
            placeholder="0 = libre"
          />
        </label>
        <label class="custom__field">
          <span>Hauteur max (px)</span>
          <UInput
            v-model.number="videoMaxH"
            type="number"
            min="0"
            max="4320"
            placeholder="0 = libre"
          />
        </label>
        <label class="custom__field">
          <span>CRF (15 = excellent · 32 = compact)</span>
          <UInput
            v-model.number="videoCrf"
            type="number"
            min="15"
            max="32"
          />
        </label>
        <label class="custom__field">
          <span>Audio (kbps)</span>
          <UInput
            v-model.number="videoAudioKbps"
            type="number"
            min="32"
            max="320"
            step="32"
          />
        </label>
      </div>
    </div>

    <div
      v-if="showImage"
      class="custom__group"
    >
      <span class="custom__group-label">Image</span>
      <div class="custom__fields">
        <label class="custom__field">
          <span>Largeur max (px)</span>
          <UInput
            v-model.number="imageMaxW"
            type="number"
            min="0"
            max="8000"
            placeholder="0 = libre"
          />
        </label>
        <label class="custom__field">
          <span>Hauteur max (px)</span>
          <UInput
            v-model.number="imageMaxH"
            type="number"
            min="0"
            max="8000"
            placeholder="0 = libre"
          />
        </label>
        <label class="custom__field">
          <span>Qualité JPEG (1–100)</span>
          <UInput
            v-model.number="imageQuality"
            type="number"
            min="1"
            max="100"
          />
        </label>
      </div>
    </div>

    <div
      v-if="showAudio"
      class="custom__group"
    >
      <span class="custom__group-label">Audio</span>
      <div class="custom__fields">
        <label class="custom__field">
          <span>Bitrate (kbps)</span>
          <UInput
            v-model.number="audioKbps"
            type="number"
            min="32"
            max="320"
            step="32"
          />
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.custom {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.custom__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
}

.custom__head-icon {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--color-icterine-400);
}

.custom__group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid #2a2a2a;
}

.custom__group:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.custom__group-label {
  font-weight: 700;
  font-size: 0.78rem;
  color: #FDF7F1;
}

.custom__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem;
}

.custom__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.72rem;
  color: #888;
}
</style>
