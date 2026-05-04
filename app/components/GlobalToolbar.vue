<script setup lang="ts">
const queue = useTranscodeQueue()
const hasActive = computed(() => queue.counts.value.active > 0 || queue.counts.value.pending > 0)
</script>

<template>
  <div
    v-if="hasActive"
    class="toolbar"
  >
    <UButton
      size="sm"
      color="neutral"
      variant="soft"
      icon="i-lucide-circle-stop"
      @click="queue.cancelAll()"
    >
      Tout annuler
    </UButton>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: flex-end;
}
</style>
