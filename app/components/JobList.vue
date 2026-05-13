<script setup lang="ts">
const queue = useTranscodeQueue()

const hasJobs = computed(() => queue.jobs.value.length > 0)
const hasFinished = computed(() =>
  queue.jobs.value.some(j => j.status.state === 'done' || j.status.state === 'cancelled')
)
const hasActive = computed(() => queue.counts.value.active > 0 || queue.counts.value.pending > 0)
const overallPct = computed(() => Math.round(queue.counts.value.overall * 100))
// SVG ring circumference at r=15.9 is ~99.9 → round to 100 for clean math.
const ringDashOffset = computed(() => 100 - overallPct.value)
</script>

<template>
  <section
    v-if="hasJobs"
    class="joblist"
  >
    <header class="joblist__head">
      <h3 class="joblist__title">
        File d'attente
      </h3>
      <div
        class="joblist__counts"
        :title="`${queue.counts.value.done} terminés · ${queue.counts.value.active} en cours · ${queue.counts.value.pending} en attente${queue.counts.value.error > 0 ? ' · ' + queue.counts.value.error + ' erreur(s)' : ''}`"
      >
        <strong>{{ queue.counts.value.done }}</strong>/<span>{{ queue.counts.value.total }}</span>
        <span
          v-if="queue.counts.value.error > 0"
          class="joblist__counts-err"
        >·  {{ queue.counts.value.error }} ⚠</span>
      </div>
      <div
        v-if="hasActive"
        class="joblist__ring"
        :title="`${overallPct}%`"
      >
        <svg viewBox="0 0 36 36">
          <circle
            class="joblist__ring-track"
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke-width="3.5"
          />
          <circle
            class="joblist__ring-fill"
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke-width="3.5"
            stroke-dasharray="100"
            :stroke-dashoffset="ringDashOffset"
            stroke-linecap="round"
          />
        </svg>
        <span class="joblist__ring-text">{{ overallPct }}<small>%</small></span>
      </div>
      <UButton
        v-if="hasFinished"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-eraser"
        aria-label="Effacer les terminés"
        title="Effacer les terminés"
        @click="queue.clearFinished()"
      />
      <UButton
        v-if="hasActive"
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-circle-stop"
        aria-label="Tout annuler"
        title="Tout annuler"
        @click="queue.cancelAll()"
      />
    </header>

    <ul class="joblist__items">
      <JobRow
        v-for="job in queue.jobs.value"
        :key="job.id"
        :job="job"
      />
    </ul>
  </section>
</template>

<style scoped>
.joblist {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.joblist__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.joblist__title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.01em;
}

.joblist__counts {
  font-size: 0.9rem;
  color: #a8a8a8;
  font-variant-numeric: tabular-nums;
  margin-right: auto;
  white-space: nowrap;

  strong {
    color: #FDF7F1;
  }
}

.joblist__counts-err {
  color: #ef4444;
  margin-left: 0.35rem;
}

.joblist__ring {
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.joblist__ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.joblist__ring-track {
  stroke: #2a2a2a;
}

.joblist__ring-fill {
  stroke: var(--color-icterine-400);
  transition: stroke-dashoffset 200ms linear;
}

.joblist__ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #d4d4d4;
  line-height: 1;
}

.joblist__ring-text small {
  font-size: 0.55em;
  opacity: 0.65;
  margin-left: 0.5px;
}

.joblist__items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.joblist__empty {
  padding: 1.25rem 0;
  color: #888;
  font-size: 0.9rem;
  text-align: center;
}
</style>
