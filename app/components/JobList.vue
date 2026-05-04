<script setup lang="ts">
const queue = useTranscodeQueue()

const hasJobs = computed(() => queue.jobs.value.length > 0)
const hasFinished = computed(() =>
  queue.jobs.value.some(j => j.status.state === 'done' || j.status.state === 'cancelled')
)
</script>

<template>
  <section class="joblist">
    <header class="joblist__head">
      <h3 class="joblist__title">
        File d'attente
      </h3>
      <div class="joblist__counts">
        <span><strong>{{ queue.counts.value.done }}</strong> terminés</span>
        <span v-if="queue.counts.value.active > 0">·  <strong>{{ queue.counts.value.active }}</strong> en cours</span>
        <span v-if="queue.counts.value.pending > 0">·  <strong>{{ queue.counts.value.pending }}</strong> en attente</span>
        <span v-if="queue.counts.value.error > 0">·  <strong style="color:#ef4444">{{ queue.counts.value.error }}</strong> erreur(s)</span>
      </div>
      <UButton
        v-if="hasFinished"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-eraser"
        @click="queue.clearFinished()"
      >
        Effacer les terminés
      </UButton>
    </header>

    <ul
      v-if="hasJobs"
      class="joblist__items"
    >
      <JobRow
        v-for="job in queue.jobs.value"
        :key="job.id"
        :job="job"
      />
    </ul>
    <div
      v-else
      class="joblist__empty"
    >
      Aucun fichier pour le moment. Déposez une vidéo pour commencer.
    </div>
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
  font-size: 0.85rem;
  color: #a8a8a8;
  display: flex;
  gap: 0.4rem;
  margin-right: auto;
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
