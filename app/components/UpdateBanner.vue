<script setup lang="ts">
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// shallowRef instead of ref — the Update instance has private class fields
// (#client, #responseType, etc.) that throw "Cannot read private member"
// when Vue's reactive proxy intercepts method calls. shallowRef keeps the
// object identity intact so `update.value.downloadAndInstall()` keeps its
// proper `this`.
const update = shallowRef<Update | null>(null)
const installing = ref(false)
const dismissed = ref(false)
const error = ref<string | null>(null)
const downloaded = ref(0)
const total = ref(0)
const phase = ref<'idle' | 'downloading' | 'installing'>('idle')

const pct = computed(() =>
  total.value > 0 ? Math.min(100, Math.round((downloaded.value / total.value) * 100)) : 0
)
const sizeLabel = computed(() => {
  if (!total.value) return ''
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)
  return `${mb(downloaded.value)} / ${mb(total.value)} Mo`
})

const btnLabel = computed(() => {
  if (phase.value === 'downloading') return total.value ? `${pct.value} %` : 'Téléchargement…'
  if (phase.value === 'installing') return 'Installation…'
  return 'Installer et redémarrer'
})

onMounted(() => {
  setTimeout(async () => {
    try {
      const u = await check()
      if (u) update.value = u
    } catch (e) {
      console.warn('updater check failed', e)
    }
  }, 5000)
})

async function install () {
  if (!update.value) return
  installing.value = true
  error.value = null
  downloaded.value = 0
  total.value = 0
  phase.value = 'downloading'
  try {
    await update.value.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total.value = event.data.contentLength ?? 0
          break
        case 'Progress':
          downloaded.value += event.data.chunkLength
          break
        case 'Finished':
          phase.value = 'installing'
          break
      }
    })
    await relaunch()
  } catch (e) {
    error.value = String(e)
    installing.value = false
    phase.value = 'idle'
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
      Mise à jour disponible v<strong>{{ update.version }}</strong>
      <span
        v-if="phase === 'downloading' && total"
        class="updbanner__sub"
      > · {{ sizeLabel }}</span>
      <span
        v-if="error"
        class="updbanner__err"
      > · {{ error }}</span>
      <div
        v-if="phase === 'downloading' && total"
        class="updbanner__bar"
      >
        <div
          class="updbanner__bar-fill"
          :style="{ width: pct + '%' }"
        />
      </div>
    </div>
    <UButton
      size="xs"
      color="primary"
      variant="solid"
      :loading="installing"
      @click="install"
    >
      {{ btnLabel }}
    </UButton>
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      aria-label="Ignorer"
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

.updbanner__sub {
  opacity: 0.7;
}

.updbanner__bar {
  height: 3px;
  margin-top: 0.35rem;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.updbanner__bar-fill {
  height: 100%;
  background: var(--color-icterine-400);
  transition: width 120ms ease;
}
</style>
