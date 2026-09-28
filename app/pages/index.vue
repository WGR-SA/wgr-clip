<script setup lang="ts">
import { CONVERT_ZONE_ID, CROP_ZONE_ID } from '~/composables/useDropTargets'

useHead({ title: 'wgr-clip' })

const queue = useTranscodeQueue()
const crop = useCropSession()

function reportError(e: unknown) {
  console.error('[index] drop failed', e)
  useToast().add({ title: 'Erreur', description: String(e), color: 'error' })
}

function onConvertDrop(paths: string[]) {
  queue.addInputs(paths).catch(reportError)
}

function onCropDrop(paths: string[]) {
  crop.open(paths).catch(reportError)
}
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

    <CropEditor v-if="crop.active.value" />
    <div
      v-else
      class="page__zones"
    >
      <DropZone
        :id="CONVERT_ZONE_ID"
        title="Déposez ou cliquez pour parcourir"
        hint="Vidéos, images, audio. Compression web en un drag."
        icon="i-lucide-arrow-down-to-line"
        @drop="onConvertDrop"
        @click="queue.pickInputFiles()"
      />
      <DropZone
        :id="CROP_ZONE_ID"
        title="Recadrer"
        hint="Déposez une image, choisissez le cadre."
        icon="i-lucide-crop"
        @drop="onCropDrop"
        @click="crop.pickImages()"
      />
    </div>

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

.page__zones {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
</style>
