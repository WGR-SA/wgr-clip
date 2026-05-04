<script setup lang="ts">
import type { Job } from '~/types/job'
import { basename, dirname } from '~/utils/format'

const props = defineProps<{ job: Job }>()
const queue = useTranscodeQueue()

const showDetails = ref(false)

const humanMessage = computed(() => {
  const e = props.job.error
  if (!e) return 'Erreur inconnue.'
  switch (e.kind) {
    case 'InputNotFound':
      return 'Le fichier source est introuvable. Il a peut-être été déplacé ou renommé.'
    case 'ProbeFailed':
      return 'Impossible de lire les métadonnées de ce fichier — il est peut-être corrompu ou utilise un conteneur inhabituel.'
    case 'UnsupportedCodec':
      return 'Le codec ou le format à l\'intérieur du fichier n\'est pas pris en charge par cette version de ffmpeg.'
    case 'OutputWriteError':
      return 'Impossible d\'écrire le fichier de sortie. Vérifiez que le dossier existe et que vous avez les droits d\'écriture.'
    case 'FfmpegCrashed':
      return 'ffmpeg a échoué pendant la conversion. Détails techniques ci-dessous.'
    case 'Cancelled':
      return 'Annulé.'
    case 'Internal':
      return 'Erreur interne. Détails techniques ci-dessous.'
  }
  return 'Erreur inconnue.'
})

const stderrText = computed(() => {
  if (props.job.stderr_tail.length > 0) return props.job.stderr_tail.join('\n')
  const e = props.job.error
  if (e && 'data' in e && e.data && typeof e.data === 'object' && 'stderr_tail' in (e.data as Record<string, unknown>)) {
    return String((e.data as { stderr_tail?: string }).stderr_tail ?? '')
  }
  return '(aucun détail capturé)'
})

async function copyDiag () {
  await queue.copyDiagnostics(props.job.id)
}
async function retry () {
  await queue.retry(props.job.id)
}
async function revealInput () {
  await queue.revealInFolder(props.job.input)
}
async function revealOutputDir () {
  const dir = dirname(props.job.output)
  if (dir) await queue.revealInFolder(dir)
}
</script>

<template>
  <div class="errpanel">
    <div class="errpanel__msg">
      <UIcon
        name="i-lucide-octagon-alert"
        class="errpanel__icon"
      />
      <div>
        <div class="errpanel__title">
          {{ humanMessage }}
        </div>
        <div class="errpanel__sub">
          {{ basename(job.input) }}
          <span v-if="job.error">·  <code>{{ job.error.kind }}</code></span>
        </div>
      </div>
    </div>

    <div class="errpanel__actions">
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-rotate-ccw"
        @click="retry"
      >
        Réessayer
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-copy"
        @click="copyDiag"
      >
        Copier les détails
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-folder-input"
        @click="revealInput"
      >
        Source
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-folder-output"
        @click="revealOutputDir"
      >
        Destination
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="showDetails ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? 'Masquer' : 'Voir' }} les détails
      </UButton>
    </div>

    <pre
      v-if="showDetails"
      class="errpanel__stderr"
    >{{ stderrText }}</pre>
  </div>
</template>

<style scoped>
.errpanel {
  margin-top: 0.5rem;
  padding: 0.85rem 1rem;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.errpanel__msg {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.errpanel__icon {
  width: 1.25rem;
  height: 1.25rem;
  color: #fca5a5;
  margin-top: 2px;
}

.errpanel__title {
  font-weight: 600;
  color: #fee2e2;
}

.errpanel__sub {
  font-size: 0.8rem;
  color: #fca5a5;
  margin-top: 2px;
}

.errpanel__sub code {
  background: rgba(0,0,0,0.25);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
}

.errpanel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.errpanel__stderr {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  margin: 0;
}
</style>
