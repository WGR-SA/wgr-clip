<script setup lang="ts">
import type { Job } from '~/types/job'
import { basename, formatDuration, formatPercent, formatSpeed } from '~/utils/format'

const props = defineProps<{ job: Job }>()
const queue = useTranscodeQueue()

const statusLabel = computed(() => {
  switch (props.job.status.state) {
    case 'pending': return 'Queued'
    case 'probing': return 'Probing'
    case 'encoding': return 'Encoding'
    case 'done': return 'Done'
    case 'error': return 'Error'
    case 'cancelled': return 'Cancelled'
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

const isActive = computed(() => props.job.status.state === 'encoding' || props.job.status.state === 'probing')
const isFinal = computed(() => ['done', 'error', 'cancelled'].includes(props.job.status.state))
const showError = computed(() => props.job.status.state === 'error' && !!props.job.error)

const percentText = computed(() => formatPercent(props.job.progress))

async function cancel () { await queue.cancel(props.job.id) }
async function revealOutput () { await queue.revealInFolder(props.job.output) }
</script>

<template>
  <li class="jobrow">
    <div class="jobrow__main">
      <div class="jobrow__head">
        <div class="jobrow__file">
          <UIcon
            name="i-lucide-film"
            class="jobrow__file-icon"
          />
          <div
            class="jobrow__name"
            :title="job.input"
          >
            {{ basename(job.input) }}
          </div>
        </div>
        <UBadge
          :color="statusColor"
          variant="subtle"
          size="sm"
        >
          {{ statusLabel }}
        </UBadge>
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
        <span v-if="isActive">·  {{ formatSpeed(job.speed_x) }}</span>
        <span v-if="isActive && job.eta_s > 0">·  ETA {{ formatDuration(job.eta_s) }}</span>
        <span v-if="isActive && job.fps > 0">·  {{ Math.round(job.fps) }} fps</span>
      </div>
    </div>

    <div class="jobrow__actions">
      <UButton
        v-if="!isFinal"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        aria-label="Cancel"
        @click="cancel"
      />
      <UButton
        v-if="job.status.state === 'done'"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-folder-output"
        aria-label="Reveal in folder"
        @click="revealOutput"
      />
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
  gap: 0;
  padding: 0.85rem 1rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.jobrow__main {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
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
  max-width: 100%;
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

.jobrow__actions {
  position: absolute;
  /* placeholder — actions render inline within head via overlap is too clever; keep absolute off and inline only */
}

/* Keep cancel inline next to badge by floating in head row instead */
.jobrow__actions {
  position: static;
  display: flex;
  gap: 0.25rem;
  margin-top: -28px;
  margin-left: auto;
  width: max-content;
  align-self: flex-end;
}
</style>
