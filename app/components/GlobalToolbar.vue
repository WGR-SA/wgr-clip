<script setup lang="ts">
import { basename } from '~/utils/format'

const queue = useTranscodeQueue()

const outputLabel = computed(() => {
  const d = queue.outputDir.value
  if (!d) return 'Auto (next to source / wgr-clip/)'
  return basename(d) || d
})

const overallPct = computed(() => Math.round(queue.counts.value.overall * 100))
const hasActive = computed(() => queue.counts.value.active > 0 || queue.counts.value.pending > 0)
</script>

<template>
  <div class="toolbar">
    <UButton
      size="sm"
      color="neutral"
      variant="soft"
      icon="i-lucide-folder-output"
      :title="queue.outputDir.value ?? 'Auto'"
      @click="queue.pickOutputDir()"
    >
      Output: {{ outputLabel }}
    </UButton>

    <div class="toolbar__progress">
      <div class="toolbar__progress-text">
        {{ queue.counts.value.done }}/{{ queue.counts.value.total }}<span v-if="hasActive"> ·  {{ overallPct }}%</span>
      </div>
      <div class="toolbar__progress-bar">
        <div
          class="toolbar__progress-fill"
          :style="{ width: `${overallPct}%` }"
        />
      </div>
    </div>

    <UButton
      v-if="hasActive"
      size="sm"
      color="neutral"
      variant="soft"
      icon="i-lucide-square"
      @click="queue.cancelAll()"
    >
      Cancel all
    </UButton>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.toolbar__progress {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.toolbar__progress-text {
  font-size: 0.78rem;
  color: #a8a8a8;
}

.toolbar__progress-bar {
  height: 4px;
  background: #2a2a2a;
  border-radius: 999px;
  overflow: hidden;
}

.toolbar__progress-fill {
  height: 100%;
  background: var(--color-icterine-400);
  transition: width 200ms linear;
  border-radius: 999px;
}
</style>
