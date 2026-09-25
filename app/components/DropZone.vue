<script setup lang="ts">
const props = defineProps<{ id: string, title: string, hint: string, icon: string }>()
const emit = defineEmits<{ drop: [paths: string[]], click: [] }>()

const { hoveredId, register } = useDropTargets()
const el = ref<HTMLElement | null>(null)
const isHover = computed(() => hoveredId.value === props.id)
let unregister: (() => void) | null = null

onMounted(() => {
  unregister = register({ id: props.id, el, onDrop: paths => emit('drop', paths) })
})

onBeforeUnmount(() => {
  unregister?.()
  unregister = null
})
</script>

<template>
  <button
    ref="el"
    type="button"
    class="dropzone"
    :class="{ 'dropzone--hover': isHover }"
    :aria-label="title"
    @click="emit('click')"
  >
    <div class="dropzone__content">
      <UIcon
        :name="icon"
        class="dropzone__icon"
      />
      <h2 class="dropzone__title">
        {{ title }}
      </h2>
      <p class="dropzone__hint">
        {{ hint }}
      </p>
    </div>
  </button>
</template>

<style scoped>
.dropzone {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 260px;
  min-height: 140px;
  padding: 1.25rem 1rem;
  border: 2px dashed #3a3a3a;
  border-radius: 14px;
  background: #1c1c1c;
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.dropzone:hover {
  border-color: #525252;
  background: #1f1f1f;
}

.dropzone:focus-visible {
  outline: 2px solid var(--color-icterine-400);
  outline-offset: 2px;
}

.dropzone--hover {
  border-color: var(--color-icterine-400);
  background: rgba(225, 253, 95, 0.04);
  transform: scale(1.005);
}

.dropzone__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  text-align: center;
}

.dropzone__icon {
  width: 1.75rem;
  height: 1.75rem;
  color: var(--color-icterine-400);
  opacity: 0.85;
  margin-bottom: 0.15rem;
}

.dropzone__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: #FDF7F1;
  margin: 0;
}

.dropzone__hint {
  font-size: 0.8rem;
  color: #a8a8a8;
  margin: 0;
}
</style>
