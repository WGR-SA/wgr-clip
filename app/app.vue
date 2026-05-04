<script setup lang="ts">
const queue = useTranscodeQueue()
const shellRef = ref<HTMLElement | null>(null)

useHead({
  htmlAttrs: { lang: 'fr', class: 'dark' }
})

onMounted(async () => {
  await queue.bindListeners()
})

useAutoFit(shellRef)
useBatchNotification()
</script>

<template>
  <UApp>
    <div
      ref="shellRef"
      class="shell"
    >
      <main class="shell__main">
        <NuxtPage />
      </main>
      <AppFooter />
    </div>
  </UApp>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  background: #232323;
  /* No min-height: 100vh — let the content + footer determine the height
     so useAutoFit can resize the window down to fit when the queue is empty. */
}

.shell__main {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
