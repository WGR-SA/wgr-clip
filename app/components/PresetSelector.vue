<script setup lang="ts">
import type { Preset } from '~/types/job'

const queue = useTranscodeQueue()

const presets: Array<{ value: Preset, label: string, hint: string, icon: string }> = [
  { value: 'web1080p', label: 'Web 1080p', hint: 'H.264, CRF 22, AAC 128k — universal web upload', icon: 'i-lucide-monitor' },
  { value: '4k', label: '4K 2160p', hint: 'H.264, CRF 20, AAC 192k — high fidelity', icon: 'i-lucide-tv' },
  { value: 'source', label: 'Source', hint: 'Keep original resolution, web container', icon: 'i-lucide-file-video' }
]

const current = computed(() => queue.preset.value)
const choose = (p: Preset) => queue.setPreset(p)
</script>

<template>
  <fieldset class="preset">
    <legend class="preset__legend">
      Preset
    </legend>
    <div class="preset__grid">
      <button
        v-for="p in presets"
        :key="p.value"
        type="button"
        class="preset__card"
        :class="{ 'preset__card--active': current === p.value }"
        @click="choose(p.value)"
      >
        <UIcon
          :name="p.icon"
          class="preset__icon"
        />
        <div class="preset__label">
          {{ p.label }}
        </div>
        <div class="preset__hint">
          {{ p.hint }}
        </div>
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.preset {
  border: 0;
  padding: 0;
  margin: 0;
}

.preset__legend {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
  margin-bottom: 0.5rem;
}

.preset__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.preset__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 0.85rem 1rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
  color: #FDF7F1;
}

.preset__card:hover {
  border-color: #3a3a3a;
}

.preset__card--active {
  border-color: var(--color-icterine-400);
  background: rgba(225, 253, 95, 0.06);
}

.preset__card--active .preset__icon {
  color: var(--color-icterine-400);
}

.preset__icon {
  width: 1.25rem;
  height: 1.25rem;
  color: #a8a8a8;
}

.preset__label {
  font-weight: 700;
  font-size: 0.95rem;
}

.preset__hint {
  font-size: 0.8rem;
  color: #888;
  line-height: 1.3;
}
</style>
