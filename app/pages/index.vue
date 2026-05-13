<script setup lang="ts">
useHead({ title: 'wgr-clip' })
</script>

<template>
  <div class="page">
    <header class="page__header">
      <h1 class="page__title">
        clip
      </h1>
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

    <JobList />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 900px;
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

.page__settings {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
}
</style>
