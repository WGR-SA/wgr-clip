<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'

const queue = useTranscodeQueue()
const version = computed(() => queue.appInfo.value?.version ?? '')

async function openSite () {
  try {
    await openUrl('https://wgr.ch')
  } catch (e) {
    console.warn('open wgr.ch failed', e)
  }
}
</script>

<template>
  <footer class="footer">
    <div class="footer__left">
      <button
        type="button"
        class="footer__brand"
        aria-label="Ouvrir wgr.ch"
        @click="openSite"
      >
        <img
          src="/img/logo.svg"
          alt="wgr"
          class="footer__logo"
        >
      </button>
      <span class="footer__location">Lausanne</span>
    </div>

    <div class="footer__meta">
      <span v-if="version">v{{ version }}</span>
      <button
        type="button"
        class="footer__link"
        @click="queue.openLogsDir()"
      >
        Journaux
      </button>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid #2a2a2a;
  font-size: 0.78rem;
  color: #888;
}

.footer__left {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.footer__brand {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  opacity: 0.85;
  transition: opacity 120ms ease;
}

.footer__brand:hover {
  opacity: 1;
}

.footer__logo {
  display: block;
  height: 14px;
  width: auto;
}

.footer__location {
  color: #888;
}

.footer__meta {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}

.footer__link {
  background: none;
  border: none;
  color: var(--color-icterine-400);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.footer__link:hover {
  text-decoration: underline;
}
</style>
