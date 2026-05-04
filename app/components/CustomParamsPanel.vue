<script setup lang="ts">
const queue = useTranscodeQueue()

const showVideo = computed(() => queue.videoPreset.value === 'custom')
const showImage = computed(() => queue.imagePreset.value === 'custom')
const showAudio = computed(() => queue.audioPreset.value === 'custom')
const visible = computed(() => showVideo.value || showImage.value || showAudio.value)

const videoMaxH = computed({
  get: () => queue.custom.value.video_max_height,
  set: (v: number) => queue.patchCustom({ video_max_height: clampInt(v, 0, 4320) })
})
const videoCrf = computed({
  get: () => queue.custom.value.video_crf,
  set: (v: number) => queue.patchCustom({ video_crf: clampInt(v, 15, 32) })
})
const videoAudioKbps = computed({
  get: () => queue.custom.value.video_audio_kbps,
  set: (v: number) => queue.patchCustom({ video_audio_kbps: clampInt(v, 32, 320) })
})

const imageMaxDim = computed({
  get: () => queue.custom.value.image_max_dim,
  set: (v: number) => queue.patchCustom({ image_max_dim: clampInt(v, 0, 8000) })
})
const imageQuality = computed({
  get: () => queue.custom.value.image_quality,
  set: (v: number) => queue.patchCustom({ image_quality: clampInt(v, 1, 100) })
})

const audioKbps = computed({
  get: () => queue.custom.value.audio_kbps,
  set: (v: number) => queue.patchCustom({ audio_kbps: clampInt(v, 32, 320) })
})

function clampInt (n: number, min: number, max: number): number {
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
          <span>Hauteur max (px)</span>
          <UInput
            v-model.number="videoMaxH"
            type="number"
            min="0"
            max="4320"
            placeholder="1080 (0 = pas de limite)"
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
          <span>Côté max (px)</span>
          <UInput
            v-model.number="imageMaxDim"
            type="number"
            min="0"
            max="8000"
            placeholder="2000 (0 = pas de limite)"
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
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
