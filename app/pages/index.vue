<script setup lang="ts">
useHead({ title: 'wgr-clip' })
</script>

<template>
  <div class="page">
    <UpdateBanner />

    <!-- Title + settings pills share the top row. clip on the left, controls
         flowing right; settings wrap to a second line on narrow windows. -->
    <section class="page__topbar">
      <h1 class="page__title">
        clip
      </h1>
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
  gap: 0.75rem;
  width: 100%;
}

.page__topbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.page__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.65rem;
  letter-spacing: -0.02em;
  line-height: 1;
  color: #FDF7F1;
  margin: 0 auto 0 0; /* push following pills to the right edge */
}
</style>
