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
      <div class="shell__inner">
        <main class="shell__main">
          <NuxtPage />
        </main>
        <AppFooter />
      </div>
    </div>
  </UApp>
</template>

<style scoped>
.shell {
  background: #232323;
}

/* Single column shared by main + footer so every element lines up to the
   same left/right edges regardless of how wide the user resizes the window. */
.shell__inner {
  display: flex;
  flex-direction: column;
}

.shell__main {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}
</style>
