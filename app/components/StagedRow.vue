<script setup lang="ts">
import type { StagedItem } from '~/types/job'
import { basename } from '~/utils/format'
import { KIND_ICON } from '~/utils/mediaKind'

const props = defineProps<{ item: StagedItem }>()
const emit = defineEmits<{ crop: [], remove: [] }>()

const cropText = computed(() => {
  const px = props.item.cropPx
  return px ? `${px.width} × ${px.height} px` : ''
})
</script>

<template>
  <li class="row">
    <UIcon
      :name="KIND_ICON[item.kind]"
      class="row__icon"
    />
    <span
      class="row__name"
      :title="item.input"
    >{{ basename(item.input) }}</span>
    <span
      v-if="cropText"
      class="row__crop"
    >
      <UIcon
        name="i-lucide-crop"
        class="row__crop-icon"
      />
      {{ cropText }}
    </span>
    <UButton
      v-if="item.kind === 'image'"
      icon="i-lucide-crop"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="`Recadrer ${basename(item.input)}`"
      @click="emit('crop')"
    />
    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="`Retirer ${basename(item.input)}`"
      @click="emit('remove')"
    />
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-top: 1px solid #2a2a2a;
}

.row:first-child {
  border-top: 0;
}

.row__icon {
  width: 0.95rem;
  height: 0.95rem;
  color: #888;
  flex-shrink: 0;
}

.row__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.8rem;
  color: #FDF7F1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__crop {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: var(--color-icterine-400);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row__crop-icon {
  width: 0.75rem;
  height: 0.75rem;
}
</style>
