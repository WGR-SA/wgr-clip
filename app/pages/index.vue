<script setup lang="ts">
useHead({ title: 'wgr-clip' })
</script>

<template>
  <div class="page">
    <header class="page__header">
      <img
        src="/img/logo.svg"
        alt="wgr"
        class="page__logo"
      >
      <div class="page__title">
        <span class="page__title-main">clip</span>
        <span class="page__title-sub">drop · convert · upload</span>
      </div>
    </header>

    <UpdateBanner />

    <DropZone />

    <div class="page__row">
      <PresetSelector class="page__preset" />
    </div>

    <GlobalToolbar />

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
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 0.25rem;
}

.page__logo {
  height: 26px;
  width: auto;
}

.page__title {
  display: flex;
  flex-direction: column;
  line-height: 1;
  margin-left: 0.25rem;
}

.page__title-main {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
}

.page__title-sub {
  font-size: 0.75rem;
  color: #888;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-top: 2px;
}

.page__row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.page__preset {
  width: 100%;
}
</style>
