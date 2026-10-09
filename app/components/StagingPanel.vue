<script setup lang="ts">
import type { MediaKind } from '~/types/job'

const staging = useStaging()
const queue = useTranscodeQueue()
const crop = useCropSession()

const KIND_ORDER: MediaKind[] = ['video', 'image', 'audio']
const kindLabel: Record<MediaKind, string> = { video: 'Vidéos', image: 'Images', audio: 'Audio' }

const groups = computed(() =>
  KIND_ORDER
    .filter(k => staging.kinds.value.has(k))
    .map(kind => ({ kind, items: staging.items.value.filter(i => i.kind === kind) }))
)

const starting = ref(false)

const countLabel = computed(() => `${staging.count.value} fichier${staging.count.value > 1 ? 's' : ''}`)

async function convert() {
  starting.value = true
  try {
    staging.clear(await queue.startStaged(staging.items.value))
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section
    v-if="staging.count.value > 0"
    class="staging"
  >
    <header class="staging__head">
      <UIcon
        name="i-lucide-list-checks"
        class="staging__head-icon"
      />
      <span>Prêt à convertir</span>
      <span class="staging__count">{{ countLabel }}</span>
    </header>

    <div
      v-for="g in groups"
      :key="g.kind"
      class="staging__group"
    >
      <div class="staging__group-head">
        <span class="staging__group-label">{{ kindLabel[g.kind] }} ({{ g.items.length }})</span>
        <PresetSelector :kind="g.kind" />
        <UButton
          v-if="g.kind === 'image' && staging.uncroppedImages.value.length > 0"
          icon="i-lucide-crop"
          label="Recadrer"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="crop.active.value"
          @click="crop.open(staging.uncroppedImages.value)"
        />
      </div>
      <ul class="staging__rows">
        <StagedRow
          v-for="item in g.items"
          :key="item.uid"
          :item="item"
          :crop-disabled="crop.active.value"
          @crop="crop.open([item.input])"
          @remove="staging.remove(item.uid)"
        />
      </ul>
    </div>

    <footer class="staging__actions">
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="starting || crop.active.value"
        @click="staging.clear()"
      >
        Tout effacer
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-play"
        :loading="starting"
        :disabled="starting || crop.active.value"
        @click="convert()"
      >
        Convertir {{ countLabel }}
      </UButton>
    </footer>
  </section>
</template>

<style scoped>
.staging {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.staging__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
}

.staging__head-icon {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--color-icterine-400);
}

.staging__count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  text-transform: none;
  letter-spacing: 0;
}

.staging__group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px solid #2a2a2a;
}

.staging__group:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.staging__group-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.staging__group-label {
  font-weight: 700;
  font-size: 0.78rem;
  color: #FDF7F1;
  margin-right: auto;
}

.staging__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 40vh;
  overflow-y: auto;
}

.staging__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
