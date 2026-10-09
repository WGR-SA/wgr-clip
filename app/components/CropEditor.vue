<script setup lang="ts">
import { CROP_ZONE_ID } from '~/composables/useDropTargets'
import { RATIO_PRESETS, cropPixelSize, fitInsideBox, moveRect, resizeRect, type Handle } from '~/utils/cropGeometry'
import { editorKeyAction } from '~/utils/editorKeys'
import { basename } from '~/utils/format'

const crop = useCropSession()
const staging = useStaging()
const queue = useTranscodeQueue()
const { register } = useDropTargets()

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const root = ref<HTMLElement | null>(null)
const wrapper = ref<HTMLElement | null>(null)

const current = computed(() => crop.current.value)

const frameStyle = computed(() => {
  const r = current.value?.rect
  if (!r) return {}
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`
  }
})

const cropPx = computed(() => {
  const c = current.value
  return c ? cropPixelSize(c.rect, c.sourceW, c.sourceH) : null
})

const sourceSizeText = computed(() => {
  const px = cropPx.value
  return px ? `${px.width} × ${px.height} px` : ''
})

// Hidden when the box is Original (0, 0) or the fit changes nothing — an
// arrow pointing at an identical number would just be noise.
const resultSizeText = computed(() => {
  const px = cropPx.value
  if (!px) return null
  const { maxW, maxH } = queue.imageBox.value
  if (maxW === 0 && maxH === 0) return null
  const fitted = fitInsideBox(px, maxW, maxH)
  if (fitted.width === px.width && fitted.height === px.height) return null
  return `${fitted.width} × ${fitted.height} px`
})

const counterText = computed(() => `${crop.index.value}/${crop.total.value}`)

let drag: { kind: 'move' | Handle, lastX: number, lastY: number } | null = null

function onPointerDown(e: PointerEvent, kind: 'move' | Handle) {
  e.preventDefault()
  e.stopPropagation()
  drag = { kind, lastX: e.clientX, lastY: e.clientY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(e: PointerEvent) {
  const c = current.value
  const box = wrapper.value?.getBoundingClientRect()
  if (!drag || !c || !box) return
  const dx = (e.clientX - drag.lastX) / box.width
  const dy = (e.clientY - drag.lastY) / box.height
  drag.lastX = e.clientX
  drag.lastY = e.clientY
  const aspect = c.sourceW / c.sourceH
  crop.setRect(drag.kind === 'move'
    ? moveRect(c.rect, dx, dy)
    : resizeRect(c.rect, drag.kind, dx, dy, crop.ratio.value, aspect))
}

function onPointerUp() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
}

function onKey(e: KeyboardEvent) {
  const action = editorKeyAction({ key: e.key, repeat: e.repeat, target: e.target instanceof HTMLElement ? e.target : null })
  if (!action) return
  e.preventDefault()
  if (action === 'confirm') void crop.confirm()
  else crop.close()
}

function reportError(e: unknown) {
  console.error('[crop] drop failed', e)
  useToast().add({ title: 'Erreur', description: String(e), color: 'error' })
}

let unregister: (() => void) | null = null

onMounted(() => {
  window.addEventListener('keydown', onKey)
  // setCrop only writes onto a staged item, so a drop here must stage before
  // it can be cropped — otherwise the file is silently dropped on confirm.
  unregister = register({
    id: CROP_ZONE_ID,
    el: root,
    onDrop: paths => void staging.add(paths).then(staged => crop.open(staged)).catch(reportError)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  onPointerUp()
  unregister?.()
  unregister = null
})
</script>

<template>
  <section
    ref="root"
    class="crop"
  >
    <header class="crop__head">
      <UIcon
        name="i-lucide-crop"
        class="crop__head-icon"
      />
      <span
        class="crop__file"
        :title="current?.input"
      >{{ current ? basename(current.input) : 'Chargement…' }}</span>
      <span class="crop__counter">{{ counterText }}</span>
    </header>

    <div class="crop__stage">
      <div
        v-if="!current"
        class="crop__spinner"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="crop__spinner-icon"
        />
      </div>
      <div
        v-else
        ref="wrapper"
        class="crop__wrapper"
      >
        <img
          :src="current.previewUrl"
          class="crop__img"
          alt=""
          draggable="false"
        >
        <div
          class="crop__frame"
          :style="frameStyle"
          @pointerdown="onPointerDown($event, 'move')"
        >
          <span
            v-for="h in HANDLES"
            :key="h"
            :class="['crop__handle', `crop__handle--${h}`]"
            @pointerdown="onPointerDown($event, h)"
          />
        </div>
      </div>
    </div>

    <div class="crop__bar">
      <div class="crop__ratios">
        <UButton
          size="xs"
          color="neutral"
          :variant="crop.ratio.value === null ? 'solid' : 'ghost'"
          @click="crop.setRatio(null)"
        >
          Libre
        </UButton>
        <UButton
          v-for="r in RATIO_PRESETS"
          :key="r.label"
          size="xs"
          color="neutral"
          :variant="crop.ratio.value === r.value ? 'solid' : 'ghost'"
          @click="crop.setRatio(r.value)"
        >
          {{ r.label }}
        </UButton>
      </div>
      <span class="crop__size">
        {{ sourceSizeText }}<span
          v-if="resultSizeText"
          class="crop__size-result"
        > → {{ resultSizeText }}</span>
      </span>
    </div>

    <footer class="crop__actions">
      <UButton
        color="neutral"
        variant="ghost"
        @click="crop.close()"
      >
        Annuler
      </UButton>
      <UButton
        v-if="crop.pending.value.length > 0"
        color="neutral"
        variant="soft"
        @click="crop.skip()"
      >
        Passer
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-crop"
        :disabled="!current"
        @click="crop.confirm()"
      >
        Valider le recadrage
      </UButton>
    </footer>
  </section>
</template>

<style scoped>
.crop {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.crop__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
}

.crop__head-icon {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--color-icterine-400);
}

.crop__file {
  font-weight: 700;
  color: #FDF7F1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: auto;
}

.crop__counter {
  color: #888;
  font-variant-numeric: tabular-nums;
}

.crop__stage {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  padding: 0.5rem;
  background: #181818;
  border-radius: 10px;
}

.crop__spinner-icon {
  width: 1.75rem;
  height: 1.75rem;
  color: var(--color-icterine-400);
  animation: crop-spin 900ms linear infinite;
}

@keyframes crop-spin {
  to { transform: rotate(360deg); }
}

/* inline-block + line-height 0 make the wrapper hug the rendered image, so
   percentage positioning of the frame maps exactly onto image fractions. */
.crop__wrapper {
  position: relative;
  display: inline-block;
  line-height: 0;
  overflow: hidden;
  border-radius: 6px;
}

.crop__img {
  display: block;
  max-width: 100%;
  max-height: 420px;
  user-select: none;
  -webkit-user-drag: none;
}

.crop__frame {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid var(--color-icterine-400);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  cursor: move;
  touch-action: none;
}

.crop__handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--color-icterine-400);
  border-radius: 2px;
  transform: translate(-50%, -50%);
  touch-action: none;
}

.crop__handle--nw { left: 0; top: 0; cursor: nwse-resize; }
.crop__handle--n { left: 50%; top: 0; cursor: ns-resize; }
.crop__handle--ne { left: 100%; top: 0; cursor: nesw-resize; }
.crop__handle--e { left: 100%; top: 50%; cursor: ew-resize; }
.crop__handle--se { left: 100%; top: 100%; cursor: nwse-resize; }
.crop__handle--s { left: 50%; top: 100%; cursor: ns-resize; }
.crop__handle--sw { left: 0; top: 100%; cursor: nesw-resize; }
.crop__handle--w { left: 0; top: 50%; cursor: ew-resize; }

.crop__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.crop__ratios {
  display: flex;
  gap: 0.2rem;
  flex-wrap: wrap;
}

.crop__size {
  margin-left: auto;
  font-size: 0.78rem;
  color: #a8a8a8;
  font-variant-numeric: tabular-nums;
}

.crop__size-result {
  color: var(--color-icterine-400);
  font-weight: 600;
}

.crop__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
