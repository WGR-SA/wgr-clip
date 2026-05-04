<script setup lang="ts">
const queue = useTranscodeQueue()
const version = computed(() => queue.appInfo.value?.version ?? '')
const hwAccel = computed(() => queue.appInfo.value?.hw_accel ?? '')
</script>

<template>
  <footer class="footer">
    <div class="footer__signature">
      Pensé, designé et codé avec passion à Lausanne — wgr SA
    </div>
    <div class="footer__meta">
      <span v-if="version">v{{ version }}</span>
      <span v-if="hwAccel">·  {{ hwAccel }}</span>
      <button
        type="button"
        class="footer__link"
        @click="queue.openLogsDir()"
      >
        Logs
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
  padding: 0.75rem 1rem;
  border-top: 1px solid #2a2a2a;
  font-size: 0.78rem;
  color: #888;
}

.footer__meta {
  display: flex;
  gap: 0.5rem;
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
