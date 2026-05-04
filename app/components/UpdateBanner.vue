<script setup lang="ts">
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

const update = ref<Update | null>(null)
const installing = ref(false)
const dismissed = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  // Auto check 5s after boot to avoid blocking initial paint
  setTimeout(async () => {
    try {
      const u = await check()
      if (u) update.value = u
    } catch (e) {
      // Network errors / unsigned dev builds — silent
      console.warn('updater check failed', e)
    }
  }, 5000)
})

async function install () {
  if (!update.value) return
  installing.value = true
  error.value = null
  try {
    await update.value.downloadAndInstall()
    await relaunch()
  } catch (e) {
    error.value = String(e)
    installing.value = false
  }
}
</script>

<template>
  <div
    v-if="update && !dismissed"
    class="updbanner"
  >
    <UIcon
      name="i-lucide-arrow-up-circle"
      class="updbanner__icon"
    />
    <div class="updbanner__msg">
      Update available — <strong>v{{ update.version }}</strong>
      <span
        v-if="error"
        class="updbanner__err"
      > · {{ error }}</span>
    </div>
    <UButton
      size="xs"
      color="primary"
      variant="solid"
      :loading="installing"
      @click="install"
    >
      {{ installing ? 'Installing…' : 'Install & restart' }}
    </UButton>
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      aria-label="Dismiss"
      @click="dismissed = true"
    />
  </div>
</template>

<style scoped>
.updbanner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.85rem;
  background: rgba(225, 253, 95, 0.06);
  border: 1px solid rgba(225, 253, 95, 0.35);
  border-radius: 10px;
  font-size: 0.85rem;
}

.updbanner__icon {
  width: 1.1rem;
  height: 1.1rem;
  color: var(--color-icterine-400);
}

.updbanner__msg {
  flex: 1;
}

.updbanner__err {
  color: #fca5a5;
}
</style>
