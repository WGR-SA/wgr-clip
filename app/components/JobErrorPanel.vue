<script setup lang="ts">
import type { Job } from '~/types/job'
import { basename, dirname } from '~/utils/format'

const props = defineProps<{ job: Job }>()
const queue = useTranscodeQueue()

const showDetails = ref(false)

const humanMessage = computed(() => {
  const e = props.job.error
  if (!e) return 'Unknown error.'
  switch (e.kind) {
    case 'InputNotFound':
      return 'The input file could not be found. It may have been moved or renamed.'
    case 'ProbeFailed':
      return 'We could not read this file\'s metadata. It might be corrupt or use an unusual container.'
    case 'UnsupportedCodec':
      return 'The codec or format inside this file is not supported by the bundled ffmpeg build.'
    case 'OutputWriteError':
      return 'We could not write the output file. Check that the output folder exists and is writable.'
    case 'FfmpegCrashed':
      return 'ffmpeg failed during the encode. Open the technical details below.'
    case 'Cancelled':
      return 'Cancelled.'
    case 'Internal':
      return 'An internal error occurred. Open the technical details below.'
  }
  return 'Unknown error.'
})

const stderrText = computed(() => {
  if (props.job.stderr_tail.length > 0) return props.job.stderr_tail.join('\n')
  const e = props.job.error
  if (e && 'data' in e && e.data && typeof e.data === 'object' && 'stderr_tail' in (e.data as Record<string, unknown>)) {
    return String((e.data as { stderr_tail?: string }).stderr_tail ?? '')
  }
  return '(no stderr captured)'
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
        Retry
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-copy"
        @click="copyDiag"
      >
        Copy diagnostics
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-folder-input"
        @click="revealInput"
      >
        Open input
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-folder-output"
        @click="revealOutputDir"
      >
        Open output
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="showDetails ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? 'Hide' : 'Show' }} details
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
