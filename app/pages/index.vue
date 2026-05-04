<script setup lang="ts">
useHead({ title: 'wgr-clip' })

const queue = useTranscodeQueue()
const showGlobalProgress = computed(() => queue.counts.value.total > 0 && (queue.counts.value.active > 0 || queue.counts.value.pending > 0))
const overallPct = computed(() => Math.round(queue.counts.value.overall * 100))
</script>

<template>
  <div class="page">
    <header class="page__header">
      <h1 class="page__title">
        clip
      </h1>
      <p class="page__tagline">
        Compresse vidéos, images et audio pour le web. Drag, drop, c'est prêt.
      </p>
    </header>

    <UpdateBanner />

    <!-- Settings: compact always-visible pills. Click any to change inline. -->
    <section class="page__settings">
      <PresetSelector kind="video" />
      <PresetSelector kind="image" />
      <PresetSelector kind="audio" />
      <DestinationPicker />
    </section>

    <CustomParamsPanel />

    <DropZone />

    <GlobalToolbar />

    <div
      v-if="showGlobalProgress"
      class="page__global-progress"
      role="progressbar"
      :aria-valuenow="overallPct"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="page__global-progress-fill"
        :style="{ width: `${overallPct}%` }"
      />
    </div>

    <JobList />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
}

.page__header {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.page__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 2rem;
  letter-spacing: -0.02em;
  line-height: 1;
  color: #FDF7F1;
  margin: 0;
}

.page__tagline {
  margin: 0;
  font-size: 0.82rem;
  color: #888;
  line-height: 1.3;
}

.page__settings {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
}

.page__global-progress {
  height: 4px;
  background: #2a2a2a;
  border-radius: 999px;
  overflow: hidden;
}

.page__global-progress-fill {
  height: 100%;
  background: var(--color-icterine-400);
  transition: width 200ms linear;
  border-radius: 999px;
}
</style>
