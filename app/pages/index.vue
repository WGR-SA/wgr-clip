<script setup lang="ts">
import { CONVERT_ZONE_ID } from '~/composables/useDropTargets'

useHead({ title: 'wgr-clip' })

const staging = useStaging()
const crop = useCropSession()
const settingsOpen = ref(false)

function reportError(e: unknown) {
  console.error('[index] drop failed', e)
  useToast().add({ title: 'Erreur', description: String(e), color: 'error' })
}

function onDrop(paths: string[]) {
  staging.add(paths).catch(reportError)
}
</script>

<template>
  <div class="page">
    <UpdateBanner />

    <section class="page__topbar">
      <h1 class="page__title">
        clip
      </h1>
      <UButton
        icon="i-lucide-settings-2"
        color="neutral"
        variant="ghost"
        aria-label="Réglages"
        @click="settingsOpen = true"
      />
    </section>

    <CropEditor v-if="crop.active.value" />
    <DropZone
      v-else
      :id="CONVERT_ZONE_ID"
      title="Déposez ou cliquez pour parcourir"
      hint="Vidéos, images, audio. Compression web en un drag."
      icon="i-lucide-arrow-down-to-line"
      :compact="staging.count.value > 0"
      @drop="onDrop"
      @click="staging.pickFiles().catch(reportError)"
    />

    <StagingPanel />
    <CustomParamsPanel />
    <JobList />

    <SettingsPanel v-model:open="settingsOpen" />
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
  margin: 0 auto 0 0; /* push the settings button to the right edge */
}
</style>
