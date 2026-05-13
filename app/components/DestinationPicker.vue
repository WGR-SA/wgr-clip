<script setup lang="ts">
import { basename } from '~/utils/format'

const queue = useTranscodeQueue()

const label = computed(() => {
  const d = queue.outputDir.value
  if (!d) return 'Même dossier'
  return basename(d) || d
})
</script>

<template>
  <button
    type="button"
    class="dest"
    :title="queue.outputDir.value ?? 'Même dossier que le fichier d\'entrée'"
    @click="queue.pickOutputDir()"
  >
    <UIcon
      name="i-lucide-folder-output"
      class="dest__icon"
      title="Destination"
    />
    <strong class="dest__label">{{ label }}</strong>
  </button>
</template>

<style scoped>
.dest {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  min-height: 30px;
  cursor: pointer;
  font-size: 0.78rem;
  color: inherit;
  white-space: nowrap;
  transition: border-color 120ms ease, background 120ms ease;
}

.dest:hover {
  border-color: #3a3a3a;
}

.dest__icon {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--color-icterine-400);
  flex-shrink: 0;
}

.dest__caption {
  color: #888;
  font-weight: 500;
}

.dest__label {
  color: #FDF7F1;
  font-weight: 700;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
