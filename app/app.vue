<script setup lang="ts">
const queue = useTranscodeQueue()

useHead({
  htmlAttrs: { lang: 'en', class: 'dark' }
})

onMounted(async () => {
  await queue.bindListeners()
})
</script>

<template>
  <UApp>
    <div class="shell">
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
  min-height: 100vh;
  background: #232323;
}

.shell__main {
  flex: 1;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
