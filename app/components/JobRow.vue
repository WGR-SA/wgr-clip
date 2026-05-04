<script setup lang="ts">
import type { Job } from '~/types/job'
import { basename, formatDuration, formatPercent, formatSpeed } from '~/utils/format'

const props = defineProps<{ job: Job }>()
const queue = useTranscodeQueue()

const statusLabel = computed(() => {
  switch (props.job.status.state) {
    case 'pending': return 'En attente'
    case 'probing': return 'Analyse'
    case 'encoding': return props.job.kind === 'image' ? 'Compression' : 'Conversion'
    case 'done': return 'Terminé'
    case 'error': return 'Erreur'
    case 'cancelled': return 'Annulé'
    default: return props.job.status.state
  }
})

const statusColor = computed(() => {
  switch (props.job.status.state) {
    case 'done': return 'success'
    case 'error': return 'error'
    case 'cancelled': return 'neutral'
    case 'encoding':
    case 'probing':
      return 'primary'
    default: return 'neutral'
  }
})

const kindIcon = computed(() => {
  switch (props.job.kind) {
    case 'image': return 'i-lucide-image'
    case 'audio': return 'i-lucide-music'
    case 'video':
    default:
      return 'i-lucide-film'
  }
})

const isActive = computed(() => props.job.status.state === 'encoding' || props.job.status.state === 'probing')
const isFinal = computed(() => ['done', 'error', 'cancelled'].includes(props.job.status.state))
const showError = computed(() => props.job.status.state === 'error' && !!props.job.error)

const percentText = computed(() => formatPercent(props.job.progress))
const showEta = computed(() => isActive.value && props.job.kind !== 'image' && props.job.eta_s > 0)
const showSpeed = computed(() => isActive.value && props.job.kind !== 'image')
const showFps = computed(() => isActive.value && props.job.kind === 'video' && props.job.fps > 0)

async function cancel () { await queue.cancel(props.job.id) }
async function revealOutput () { await queue.revealInFolder(props.job.output) }
</script>

<template>
  <li class="jobrow">
    <div class="jobrow__head">
      <div class="jobrow__file">
        <UIcon
          :name="kindIcon"
          class="jobrow__file-icon"
        />
        <div
          class="jobrow__name"
          :title="job.input"
        >
          {{ basename(job.input) }}
        </div>
      </div>
      <div class="jobrow__status">
        <UBadge
          :color="statusColor"
          variant="subtle"
          size="sm"
        >
          {{ statusLabel }}
        </UBadge>
        <UButton
          v-if="!isFinal"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          aria-label="Annuler"
          @click="cancel"
        />
        <UButton
          v-if="job.status.state === 'done'"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-folder-output"
          aria-label="Ouvrir le dossier"
          @click="revealOutput"
        />
      </div>
    </div>

    <div class="jobrow__bar">
      <div
        class="jobrow__bar-fill"
        :class="{ 'jobrow__bar-fill--done': job.status.state === 'done', 'jobrow__bar-fill--error': job.status.state === 'error' }"
        :style="{ width: `${Math.max(0, Math.min(1, job.progress)) * 100}%` }"
      />
    </div>

    <div class="jobrow__meta">
      <span>{{ percentText }}</span>
      <span v-if="showSpeed">·  {{ formatSpeed(job.speed_x) }}</span>
      <span v-if="showEta">·  reste {{ formatDuration(job.eta_s) }}</span>
      <span v-if="showFps">·  {{ Math.round(job.fps) }} ips</span>
    </div>

    <JobErrorPanel
      v-if="showError"
      :job="job"
    />
  </li>
</template>

<style scoped>
.jobrow {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.85rem 1rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.jobrow__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.jobrow__file {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}

.jobrow__file-icon {
  width: 1rem;
  height: 1rem;
  color: #888;
  flex-shrink: 0;
}

.jobrow__name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.jobrow__status {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.jobrow__bar {
  position: relative;
  height: 6px;
  background: #2a2a2a;
  border-radius: 999px;
  overflow: hidden;
}

.jobrow__bar-fill {
  height: 100%;
  background: var(--color-icterine-400);
  transition: width 160ms linear;
  border-radius: 999px;
}

.jobrow__bar-fill--done {
  background: #22c55e;
}

.jobrow__bar-fill--error {
  background: #ef4444;
}

.jobrow__meta {
  font-size: 0.78rem;
  color: #888;
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
</style>
