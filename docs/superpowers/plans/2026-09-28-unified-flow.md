# Unified Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn wgr-clip's two separate entry points (convert zone, crop zone) into one flow — a drop stages files, preset and crop are attributes of the staged batch, one button starts the encode.

**Architecture:** A new staging layer holds `StagedItem[]` between the drop and `start_jobs`. Pure cores in `app/utils/*` with injected deps (`staging.ts`, `jobStart.ts`, `mediaKind.ts`) carry all the logic and are covered by Vitest; the `use*` composables stay thin Tauri/Nuxt wrappers. The crop session is repointed from "start a job" to "write a rect on a staged item" by swapping one injected dep. No Rust changes.

**Tech Stack:** Tauri 2, Nuxt 4 + Nuxt UI 4 (Reka UI), TypeScript strict, Vitest, native CSS with Tailwind v4 `@theme` tokens.

**Spec:** `docs/superpowers/specs/2026-09-28-unified-flow-design.md`

## Global Constraints

- **Tauri 2**, not v1. Nuxt 4 + Nuxt UI 4, Tailwind v4 via `@theme` — no `tailwind.config.ts`.
- **UI copy in French**, code and comments in English.
- **Comments only where the WHY is non-obvious.** No comment that paraphrases the code.
- **No defensive code at internal boundaries.** Trust the Rust ↔ JS contract; validate only user input.
- **TypeScript strict, never `any`.** Immutable updates, pure functions by default.
- Palette: bg `#232323`, text `#FDF7F1`, accent `var(--color-icterine-400)` `#E1FD5F`, panel `#1c1c1c`, border `#2a2a2a`.
- Tests live in `app/**/*.test.ts` (`npm test`). Component behaviour is verified by `npm run lint`, `npm run typecheck` and a manual pass in `npm run tauri:dev` — this repo has no component test harness.
- **Crop rects are fractions (0..1), never pixels.**
- Chantier 1 must run in its own worktree, created with the `superpowers:using-git-worktrees` skill. Never switch branches in the shared checkout — parallel sessions use it.

## Review Focus

Five behaviours the spec implies that no obvious task test would cover. Each has its test assigned below.

1. **The same file dropped in two separate drops** must not stage twice — dedupe has to hold against items already staged, not just within one call. → Task 4.
2. **Re-dropping a file that already carries a crop** must keep that crop, not reset it to `null`. → Task 4.
3. **`setCrop` for an input that is no longer staged** (the row was removed while the editor was open on it) must be a silent no-op, never a phantom item. → Task 4.
4. **A mixed batch where one group's `start_jobs` fails**: the other group's jobs still start, and only its uids come back so the failed items stay staged. → Task 6.
5. **Pressing "Convertir" with nothing staged** must not issue a `start_jobs` call with an empty `inputs` array. → Task 6 (logic) and Task 9 (disabled button).

---

## Task 1: Land the preset branch (chantier 0)

Rebase and merge `worktree-feat-preset-import` with no UX rework. This is its own PR.

**Files:**
- Rebase: branch `worktree-feat-preset-import` (tip `c1830b2`, 4 commits) onto `master`
- Resolve: `vitest.config.ts`, `app/pages/index.vue`, `app/components/CustomParamsPanel.vue`, `app/types/job.ts`, `app/composables/useTranscodeQueue.ts`
- Move: `tests/userPresets.test.ts` → `app/utils/userPresets.test.ts`

- [ ] **Step 1: Rebase inside the existing worktree**

The worktree is already there and locked. Never do this from the shared checkout.

```bash
cd /Users/damiengrossfeld/Sites/sites/wgr-clip/.claude/worktrees/feat-preset-import
git status                 # must be clean before starting
git rebase master
```

- [ ] **Step 2: Resolve `vitest.config.ts` — keep master's version entirely**

This is the trap. The branch's version drops the `~` alias and narrows `include` to `tests/**`, which would silently stop running all 52 tests in `app/**`. Master's version is correct as-is:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) }
  },
  test: {
    include: ['app/**/*.test.ts']
  }
})
```

```bash
git checkout --ours vitest.config.ts   # during rebase, --ours is master
git add vitest.config.ts
```

- [ ] **Step 3: Move the branch's test to the documented location**

`CLAUDE.md` documents `app/**/*.test.ts` as the test location, and six files already live there against one in `tests/`. Move it rather than widening the glob.

```bash
git mv tests/userPresets.test.ts app/utils/userPresets.test.ts
rmdir tests 2>/dev/null || true
```

Then fix its two relative imports, which were written for the old depth:

```ts
import type { CustomParams } from '~/types/job'
import {
  describeUserPreset,
  isBuiltinPreset,
  mergeUserPresets,
  parseUserPresetFile,
  toCustomParams,
  userIdFromSelection,
  type UserPreset
} from './userPresets'
```

- [ ] **Step 4: Resolve `app/pages/index.vue` — take master's version**

The branch is based on the single-zone index from before the crop editor, so its version of this file is stale. Keep master's two-zone index and add one line to it:

```bash
git checkout --ours app/pages/index.vue
```

Then insert `<PresetManagerModal />` immediately after `<CustomParamsPanel />` in the template. It is deleted again in Task 11; it lands here so the branch ships coherently.

- [ ] **Step 5: Resolve the three remaining files by taking the branch side**

`app/types/job.ts`, `app/components/CustomParamsPanel.vue` and `app/composables/useTranscodeQueue.ts` all change for the L×H box and the `PresetSelection` type. Take the branch's version, then re-apply master's crop additions on top, which the branch never saw:

- `app/types/job.ts` — keep the branch's `PresetSelection` and L×H `CustomParams`, **and** keep master's `CropRect`, `MediaSize`, and `Job.crop`.
- `app/composables/useTranscodeQueue.ts` — keep the branch's `resolveSelection`/`isAvailable`/`slug` work, **and** keep master's `addCroppedInput`, the `crop` argument threaded into `makeJob`, and the `export` on `detectKind` and `IMAGE_EXTS` (`useCropSession` imports both).
- `app/components/CustomParamsPanel.vue` — take the branch's version wholesale; it has no crop-related content.

- [ ] **Step 6: Verify the whole suite, not just the new test**

```bash
npm test
```

Expected: **7 test files, 52 + userPresets tests passing.** If you see 1 file or ~14 tests, Step 2 was resolved wrong — go back.

```bash
npm run lint && npm run typecheck
```

Expected: both clean.

- [ ] **Step 7: Manual smoke test**

```bash
npm run tauri:dev
```

Drop an image → converts. Open a preset dropdown → "Gérer les presets…" opens the modal. Import `presets/example.json` → its entries appear in the matching kind's dropdown and survive a relaunch.

- [ ] **Step 8: Push and open the PR**

```bash
git push -u origin worktree-feat-preset-import
gh pr create --title "feat(presets): import JSON user presets" --body-file <(printf '%s\n' "Imports named presets from a JSON file, persists them and offers them per kind." "" "Rebased onto master after the crop editor landed. vitest.config.ts keeps master's alias and app/** glob; the branch's test moved to app/utils/userPresets.test.ts to match the documented convention." "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
```

Merge it before starting Task 2. Everything below assumes this baseline.

---

## Task 2: Shared foundations — media kind, StagedItem, ToastSpec

Three modules need `detectKind`; it currently lives in `useTranscodeQueue`, so `useStaging` would have to import a composable from a util's consumer. Move the pure part out.

**Files:**
- Create: `app/utils/mediaKind.ts`, `app/utils/mediaKind.test.ts`
- Modify: `app/types/job.ts`, `app/composables/useTranscodeQueue.ts`, `app/composables/useCropSession.ts`, `app/utils/cropSession.ts`, `app/utils/cropSession.test.ts`

**Interfaces:**
- Produces: `detectKind(path: string): MediaKind`, `IMAGE_EXTS: string[]`, `ALL_MEDIA_EXTS: string[]` from `~/utils/mediaKind`; `StagedItem` and `ToastSpec` from `~/types/job`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/mediaKind.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_MEDIA_EXTS, IMAGE_EXTS, detectKind } from './mediaKind'

describe('detectKind', () => {
  it('reads the extension case-insensitively', () => {
    expect(detectKind('/d/a.HEIC')).toBe('image')
    expect(detectKind('/d/a.MP3')).toBe('audio')
    expect(detectKind('/d/a.MoV')).toBe('video')
  })

  it('falls back to video for unknown and missing extensions', () => {
    expect(detectKind('/d/weird.xyz')).toBe('video')
    expect(detectKind('/d/noext')).toBe('video')
  })

  it('ignores dots in parent directories', () => {
    expect(detectKind('/d/v1.2/clip')).toBe('video')
    expect(detectKind('/d/v1.2/photo.jpg')).toBe('image')
  })

  it('exposes image extensions as a subset of the full media list', () => {
    expect(IMAGE_EXTS).toContain('heic')
    for (const ext of IMAGE_EXTS) expect(ALL_MEDIA_EXTS).toContain(ext)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run app/utils/mediaKind.test.ts`
Expected: FAIL — cannot resolve `./mediaKind`.

- [ ] **Step 3: Create the module**

Create `app/utils/mediaKind.ts`, moving the three lists and `detectKind` verbatim out of `useTranscodeQueue.ts`:

```ts
import type { MediaKind } from '~/types/job'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mts', 'm2ts', 'ts', '3gp']
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif']

export const ALL_MEDIA_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS]

export function detectKind(path: string): MediaKind {
  const m = path.toLowerCase().match(/\.([^./\\]+)$/)
  const ext = (m && m[1]) ? m[1] : ''
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  return 'video'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/mediaKind.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the two shared types**

In `app/types/job.ts`, append:

```ts
/** A file waiting to be converted. No backend id — those come from start_jobs. */
export interface StagedItem {
  uid: string
  input: string
  kind: MediaKind
  crop: CropRect | null
  /** Result size in px, filled at confirm time so the row can show a badge. */
  cropPx: MediaSize | null
}

export interface ToastSpec {
  title: string
  description?: string
  color?: 'warning' | 'error' | 'success'
  duration?: number
}
```

`ToastSpec` moves here from `cropSession.ts` so `staging.ts` and `jobStart.ts` do not have to import a type from a sibling core. Delete the interface from `cropSession.ts` and import it instead — do **not** re-export it, Nuxt auto-imports flagged a duplicated re-export before (commit `fffcfe0`).

In `app/utils/cropSession.ts`:

```ts
import type { CropRect, MediaKind, MediaSize, ToastSpec } from '~/types/job'
```

In `app/utils/cropSession.test.ts`, change the import to pull `ToastSpec` from the types module:

```ts
import type { CropRect, MediaKind, MediaSize, ToastSpec } from '~/types/job'
import { createCropSession, initialCropState, type CropSessionDeps } from './cropSession'
```

- [ ] **Step 6: Repoint the two consumers**

In `app/composables/useTranscodeQueue.ts`: delete the ext lists and `detectKind`, and import them.

```ts
import { detectKind } from '~/utils/mediaKind'
```

In `app/composables/useCropSession.ts`, replace the import from the queue composable:

```ts
import { IMAGE_EXTS, detectKind } from '~/utils/mediaKind'
```

Grep for leftovers — nothing outside `mediaKind.ts` may still import these from the queue:

```bash
grep -rn "IMAGE_EXTS\|detectKind" app/ --include=*.ts --include=*.vue
```

- [ ] **Step 7: Run the full suite, lint and typecheck**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: all test files pass (the 7 from Task 1 plus `mediaKind`), lint and typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add app/utils/mediaKind.ts app/utils/mediaKind.test.ts app/types/job.ts app/utils/cropSession.ts app/utils/cropSession.test.ts app/composables/useTranscodeQueue.ts app/composables/useCropSession.ts
git commit -m "refactor: extract mediaKind util, add StagedItem and ToastSpec types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Crop pixel size helper

`CropEditor` already computes the cropped pixel size for its readout, and the crop session now needs the same number for `cropPx`. One pure helper, used by both.

**Files:**
- Modify: `app/utils/cropGeometry.ts`, `app/utils/cropGeometry.test.ts`

**Interfaces:**
- Consumes: `CropRect`, `MediaSize` from `~/types/job` (Task 2).
- Produces: `cropPixelSize(rect: CropRect, sourceW: number, sourceH: number): MediaSize`.

- [ ] **Step 1: Write the failing test**

Append to `app/utils/cropGeometry.test.ts`:

```ts
describe('cropPixelSize', () => {
  it('multiplies the fractional rect by the source size and rounds', () => {
    expect(cropPixelSize({ x: 0, y: 0, w: 0.5, h: 0.25 }, 4000, 3000)).toEqual({ width: 2000, height: 750 })
  })

  it('rounds to the nearest pixel rather than truncating', () => {
    expect(cropPixelSize({ x: 0, y: 0, w: 1 / 3, h: 1 / 3 }, 100, 100)).toEqual({ width: 33, height: 33 })
    expect(cropPixelSize({ x: 0, y: 0, w: 0.666, h: 0.666 }, 100, 100)).toEqual({ width: 67, height: 67 })
  })

  it('never reports a zero dimension for a non-empty rect', () => {
    const size = cropPixelSize({ x: 0, y: 0, w: 0.001, h: 0.001 }, 100, 100)
    expect(size.width).toBeGreaterThanOrEqual(1)
    expect(size.height).toBeGreaterThanOrEqual(1)
  })
})
```

Add `cropPixelSize` to the existing import at the top of the file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run app/utils/cropGeometry.test.ts`
Expected: FAIL — `cropPixelSize is not a function`.

- [ ] **Step 3: Implement it**

Append to `app/utils/cropGeometry.ts`:

```ts
import type { MediaSize } from '~/types/job'

export function cropPixelSize(rect: CropRect, sourceW: number, sourceH: number): MediaSize {
  return {
    width: Math.max(1, Math.round(rect.w * sourceW)),
    height: Math.max(1, Math.round(rect.h * sourceH))
  }
}
```

Merge the `MediaSize` import into the file's existing type import rather than adding a second line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/cropGeometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the editor's readout**

In `app/components/CropEditor.vue`, replace the hand-rolled `sizeText` arithmetic with the helper:

```ts
import { RATIO_PRESETS, cropPixelSize, moveRect, resizeRect, type Handle } from '~/utils/cropGeometry'

const sizeText = computed(() => {
  const c = current.value
  if (!c) return ''
  const px = cropPixelSize(c.rect, c.sourceW, c.sourceH)
  return `${px.width} × ${px.height} px`
})
```

- [ ] **Step 6: Commit**

```bash
git add app/utils/cropGeometry.ts app/utils/cropGeometry.test.ts app/components/CropEditor.vue
git commit -m "refactor(crop): extract cropPixelSize helper

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Staging core

The heart of the feature. Pure, injected deps, fully tested.

**Files:**
- Create: `app/utils/staging.ts`, `app/utils/staging.test.ts`

**Interfaces:**
- Consumes: `StagedItem`, `ToastSpec`, `CropRect`, `MediaKind`, `MediaSize` from `~/types/job`; `splitIcloudStubs`, `icloudToast` from `~/utils/icloud`; `basename` from `~/utils/format`.
- Produces: `initialStagingState(): StagingState`, `createStaging(state: Ref<StagingState>, deps: StagingDeps)` exposing `items`, `count`, `kinds`, `uncroppedImages`, `add(rawPaths)`, `remove(uid)`, `clear(uids?)`, `setCrop(input, crop, cropPx)`. Also `StagingState`, `StagingDeps`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/staging.test.ts`:

```ts
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { MediaKind, ToastSpec } from '~/types/job'
import { createStaging, initialStagingState, type StagingDeps } from './staging'

function kindOf(path: string): MediaKind {
  if (/\.(jpe?g|heic|png)$/i.test(path)) return 'image'
  if (/\.(mp3|wav)$/i.test(path)) return 'audio'
  return 'video'
}

function harness(overrides: Partial<StagingDeps> = {}) {
  const toasts: ToastSpec[] = []
  let n = 0
  const deps: StagingDeps = {
    expandPaths: async paths => paths,
    detectKind: kindOf,
    toast: t => void toasts.push(t),
    newUid: () => `u${++n}`,
    ...overrides
  }
  const state = ref(initialStagingState())
  return { staging: createStaging(state, deps), state, toasts }
}

describe('createStaging add', () => {
  it('stages every expanded file with its detected kind', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.mov', '/d/c.mp3'] })
    await h.staging.add(['/d'])
    expect(h.staging.items.value.map(i => [i.input, i.kind])).toEqual([
      ['/d/a.jpg', 'image'],
      ['/d/b.mov', 'video'],
      ['/d/c.mp3', 'audio']
    ])
    expect(h.staging.count.value).toBe(3)
    expect(h.staging.kinds.value).toEqual(new Set(['image', 'video', 'audio']))
  })

  it('dedupes within a single drop', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/a.jpg'] })
    await h.staging.add(['/d'])
    expect(h.staging.count.value).toBe(1)
  })

  // Review Focus 1
  it('dedupes against files staged by an earlier drop', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    await h.staging.add(['/d/a.jpg', '/d/b.jpg'])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/a.jpg', '/d/b.jpg'])
  })

  // Review Focus 2
  it('a re-dropped file keeps the crop it already carries', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 50, height: 50 })
    await h.staging.add(['/d/a.jpg'])
    expect(h.staging.count.value).toBe(1)
    expect(h.staging.items.value[0]!.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(h.staging.items.value[0]!.cropPx).toEqual({ width: 50, height: 50 })
  })

  it('toasts iCloud placeholders and stages the rest of the same drop', async () => {
    const h = harness({ expandPaths: async paths => paths })
    await h.staging.add(['/d/.photo.jpg.icloud', '/d/real.jpg'])
    expect(h.toasts[0]?.title).toBe('Fichier iCloud non téléchargé')
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/real.jpg'])
  })

  it('toasts and stages nothing when expansion finds no supported file', async () => {
    const h = harness({ expandPaths: async () => [] })
    await h.staging.add(['/d/notes.txt'])
    expect(h.toasts[0]?.title).toBe('Aucun fichier supporté')
    expect(h.toasts[0]?.description).toContain('notes.txt')
    expect(h.staging.count.value).toBe(0)
  })

  it('toasts and keeps the existing items when expansion throws', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    const boom = harness({ expandPaths: async () => { throw new Error('EACCES') } })
    await boom.staging.add(['/d/b.jpg'])
    expect(boom.toasts[0]?.title).toBe('Erreur de lecture du drop')
    expect(boom.staging.count.value).toBe(0)
    expect(h.staging.count.value).toBe(1)
  })
})

describe('createStaging crop', () => {
  it('writes rect and cropPx on the matching item and leaves siblings alone', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.setCrop('/d/b.jpg', { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, { width: 800, height: 800 })
    expect(h.staging.items.value[0]!.crop).toBeNull()
    expect(h.staging.items.value[1]!.crop).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(h.staging.items.value[1]!.cropPx).toEqual({ width: 800, height: 800 })
  })

  // Review Focus 3
  it('setCrop for an input that is no longer staged is a no-op', async () => {
    const h = harness()
    await h.staging.add(['/d/a.jpg'])
    h.staging.remove(h.staging.items.value[0]!.uid)
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 50, height: 50 })
    expect(h.staging.count.value).toBe(0)
  })

  it('uncroppedImages lists only images still missing a crop', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg', '/d/c.mov'] })
    await h.staging.add(['/d'])
    h.staging.setCrop('/d/a.jpg', { x: 0, y: 0, w: 1, h: 1 }, { width: 10, height: 10 })
    expect(h.staging.uncroppedImages.value).toEqual(['/d/b.jpg'])
  })
})

describe('createStaging remove and clear', () => {
  it('removes one item by uid', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.remove('u1')
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/b.jpg'])
  })

  it('clear with no argument empties everything', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg'] })
    await h.staging.add(['/d'])
    h.staging.clear()
    expect(h.staging.count.value).toBe(0)
  })

  it('clear with uids keeps the items it was not given', async () => {
    const h = harness({ expandPaths: async () => ['/d/a.jpg', '/d/b.jpg', '/d/c.jpg'] })
    await h.staging.add(['/d'])
    h.staging.clear(['u1', 'u3'])
    expect(h.staging.items.value.map(i => i.input)).toEqual(['/d/b.jpg'])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run app/utils/staging.test.ts`
Expected: FAIL — cannot resolve `./staging`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/staging.ts`:

```ts
import { computed, type Ref } from 'vue'
import type { CropRect, MediaKind, MediaSize, StagedItem, ToastSpec } from '~/types/job'
import { basename } from '~/utils/format'
import { icloudToast, splitIcloudStubs } from '~/utils/icloud'

export interface StagingState {
  items: StagedItem[]
}

export function initialStagingState(): StagingState {
  return { items: [] }
}

export interface StagingDeps {
  expandPaths: (paths: string[]) => Promise<string[]>
  detectKind: (path: string) => MediaKind
  toast: (spec: ToastSpec) => void
  newUid: () => string
}

export function createStaging(state: Ref<StagingState>, deps: StagingDeps) {
  async function add(rawPaths: string[]) {
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) deps.toast(icloudToast(split.stubs))
    if (split.paths.length === 0) return

    let expanded: string[]
    try {
      expanded = await deps.expandPaths(split.paths)
    } catch (e) {
      deps.toast({ title: 'Erreur de lecture du drop', description: String(e), color: 'error' })
      return
    }

    if (expanded.length === 0) {
      deps.toast({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : vidéo, image ou audio courants. Reçu : ${split.paths.map(basename).join(', ')}`,
        color: 'warning'
      })
      return
    }

    const known = new Set(state.value.items.map(i => i.input))
    const fresh: StagedItem[] = []
    for (const input of expanded) {
      if (known.has(input)) continue
      known.add(input)
      fresh.push({ uid: deps.newUid(), input, kind: deps.detectKind(input), crop: null, cropPx: null })
    }
    if (fresh.length > 0) state.value.items = [...state.value.items, ...fresh]
  }

  function setCrop(input: string, crop: CropRect, cropPx: MediaSize) {
    state.value.items = state.value.items.map(i => i.input === input ? { ...i, crop, cropPx } : i)
  }

  function remove(uid: string) {
    state.value.items = state.value.items.filter(i => i.uid !== uid)
  }

  function clear(uids?: string[]) {
    if (!uids) {
      state.value.items = []
      return
    }
    const gone = new Set(uids)
    state.value.items = state.value.items.filter(i => !gone.has(i.uid))
  }

  return {
    items: computed(() => state.value.items),
    count: computed(() => state.value.items.length),
    kinds: computed(() => new Set(state.value.items.map(i => i.kind))),
    uncroppedImages: computed(() => state.value.items.filter(i => i.kind === 'image' && i.crop === null).map(i => i.input)),
    add,
    setCrop,
    remove,
    clear
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/staging.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add app/utils/staging.ts app/utils/staging.test.ts
git commit -m "feat(staging): add staging core with dedupe and crop attachment

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Staging composable

**Files:**
- Create: `app/composables/useStaging.ts`

**Interfaces:**
- Consumes: `createStaging`, `initialStagingState`, `StagingState` from `~/utils/staging`; `ALL_MEDIA_EXTS`, `detectKind` from `~/utils/mediaKind`.
- Produces: `useStaging()` returning the core's surface plus `pickFiles(): Promise<void>`.

- [ ] **Step 1: Write the composable**

Create `app/composables/useStaging.ts`. `pickFiles` moves here from `useTranscodeQueue.pickInputFiles` — acquiring input is a staging concern now.

```ts
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ALL_MEDIA_EXTS, detectKind } from '~/utils/mediaKind'
import { createStaging, initialStagingState, type StagingState } from '~/utils/staging'

export function useStaging() {
  const state = useState<StagingState>('wgr-clip-staging', initialStagingState)
  const toast = useToast()

  const staging = createStaging(state, {
    expandPaths: paths => invoke<string[]>('expand_paths', { paths }),
    detectKind,
    toast: spec => toast.add(spec),
    newUid: () => crypto.randomUUID()
  })

  async function pickFiles() {
    const result = await openDialog({
      multiple: true,
      filters: [{ name: 'Médias', extensions: [...ALL_MEDIA_EXTS] }]
    })
    if (Array.isArray(result)) await staging.add(result)
    else if (typeof result === 'string') await staging.add([result])
  }

  return { ...staging, pickFiles }
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npm run lint && npm run typecheck
```

Expected: clean. A `useState` key collision would surface here.

- [ ] **Step 3: Commit**

```bash
git add app/composables/useStaging.ts
git commit -m "feat(staging): add useStaging composable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Job start core — batching, sequencing, partial failure

The riskiest logic in the feature: `start_jobs` takes one crop per call, so cropped images cannot share a batch, and the calls must be serialised. It lives in a pure core so both facts are pinned by tests.

**Files:**
- Create: `app/utils/jobStart.ts`, `app/utils/jobStart.test.ts`

**Interfaces:**
- Consumes: `StagedItem`, `CropRect`, `MediaKind`, `CustomParams`, `Preset`, `ToastSpec` from `~/types/job`.
- Produces: `groupStartBatches(items: StagedItem[]): StartBatch[]`; `startBatches(items: StagedItem[], deps: JobStartDeps): Promise<string[]>` returning the uids that started; types `StartBatch`, `ResolvedPreset`, `StartedJob`, `JobStartDeps`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/jobStart.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CropRect, StagedItem, ToastSpec } from '~/types/job'
import { groupStartBatches, startBatches, type JobStartDeps, type StartedJob } from './jobStart'

const RECT_A: CropRect = { x: 0, y: 0, w: 0.5, h: 0.5 }
const RECT_B: CropRect = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }

function item(uid: string, input: string, kind: StagedItem['kind'], crop: CropRect | null = null): StagedItem {
  return { uid, input, kind, crop, cropPx: crop ? { width: 1, height: 1 } : null }
}

interface Call { inputs: string[], crop: CropRect | null, preset: string, slug: string | null, outputDir: string | null }

function harness(overrides: Partial<JobStartDeps> = {}) {
  const calls: Call[] = []
  const jobs: StartedJob[] = []
  const toasts: ToastSpec[] = []
  let n = 0
  const deps: JobStartDeps = {
    startJobs: async (args) => {
      calls.push({ inputs: args.inputs, crop: args.crop, preset: args.preset, slug: args.slug, outputDir: args.output_dir })
      return args.inputs.map(() => `id${++n}`)
    },
    resolveSelection: kind => ({ preset: 'source', custom: null, slug: kind === 'image' ? 'web' : null }),
    outputDir: () => '/out',
    onJobs: started => void jobs.push(...started),
    toast: t => void toasts.push(t),
    ...overrides
  }
  return { deps, calls, jobs, toasts }
}

describe('groupStartBatches', () => {
  it('coalesces uncropped items of the same kind into one batch', () => {
    const batches = groupStartBatches([
      item('1', '/a.jpg', 'image'),
      item('2', '/b.mov', 'video'),
      item('3', '/c.jpg', 'image')
    ])
    expect(batches).toHaveLength(2)
    expect(batches[0]).toMatchObject({ kind: 'image', crop: null, inputs: ['/a.jpg', '/c.jpg'], uids: ['1', '3'] })
    expect(batches[1]).toMatchObject({ kind: 'video', crop: null, inputs: ['/b.mov'], uids: ['2'] })
  })

  it('gives every cropped image a batch of its own', () => {
    const batches = groupStartBatches([
      item('1', '/a.jpg', 'image', RECT_A),
      item('2', '/b.jpg', 'image', RECT_B),
      item('3', '/c.jpg', 'image')
    ])
    expect(batches).toHaveLength(3)
    expect(batches.map(b => b.crop)).toEqual([RECT_A, RECT_B, null])
  })

  it('returns nothing for an empty list', () => {
    expect(groupStartBatches([])).toEqual([])
  })
})

describe('startBatches', () => {
  it('passes the resolved preset, slug, output dir and crop to each call', async () => {
    const h = harness()
    const started = await startBatches([item('1', '/a.jpg', 'image', RECT_A)], h.deps)
    expect(h.calls).toEqual([{ inputs: ['/a.jpg'], crop: RECT_A, preset: 'source', slug: 'web', outputDir: '/out' }])
    expect(started).toEqual(['1'])
  })

  it('reports each started job with its id, input, kind and crop', async () => {
    const h = harness()
    await startBatches([item('1', '/a.jpg', 'image', RECT_A), item('2', '/b.mov', 'video')], h.deps)
    expect(h.jobs).toMatchObject([
      { id: 'id1', input: '/a.jpg', kind: 'image', crop: RECT_A },
      { id: 'id2', input: '/b.mov', kind: 'video', crop: null }
    ])
  })

  // Review Focus 5
  it('issues no call at all for an empty staging list', async () => {
    const h = harness()
    expect(await startBatches([], h.deps)).toEqual([])
    expect(h.calls).toEqual([])
  })

  // Review Focus 4
  it('keeps going when one batch fails and returns only the uids that started', async () => {
    const h = harness({
      startJobs: vi.fn(async (args) => {
        if (args.inputs[0]!.endsWith('.mov')) throw new Error('ffmpeg missing')
        return args.inputs.map((_, i) => `ok${i}`)
      })
    })
    const started = await startBatches([
      item('1', '/a.jpg', 'image'),
      item('2', '/b.mov', 'video'),
      item('3', '/c.jpg', 'image')
    ], h.deps)
    expect(started).toEqual(['1', '3'])
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]?.title).toBe('Échec du démarrage (video)')
  })

  it('never starts a batch before the previous one has returned', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const gate = new Promise<void>((res) => { releaseFirst = res })
    const h = harness({
      startJobs: async (args) => {
        order.push(`start:${args.inputs[0]}`)
        if (args.inputs[0] === '/a.jpg') await gate
        order.push(`end:${args.inputs[0]}`)
        return args.inputs.map(() => 'id')
      }
    })
    const running = startBatches([item('1', '/a.jpg', 'image'), item('2', '/b.mov', 'video')], h.deps)
    await new Promise(r => setTimeout(r, 0))
    expect(order).toEqual(['start:/a.jpg'])
    releaseFirst()
    await running
    expect(order).toEqual(['start:/a.jpg', 'end:/a.jpg', 'start:/b.mov', 'end:/b.mov'])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run app/utils/jobStart.test.ts`
Expected: FAIL — cannot resolve `./jobStart`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/jobStart.ts`:

```ts
import type { CropRect, CustomParams, MediaKind, Preset, StagedItem, ToastSpec } from '~/types/job'

export interface StartBatch {
  kind: MediaKind
  crop: CropRect | null
  uids: string[]
  inputs: string[]
}

export interface ResolvedPreset {
  preset: Preset
  custom: CustomParams | null
  slug: string | null
}

export interface StartJobsArgs {
  inputs: string[]
  preset: Preset
  custom: CustomParams | null
  slug: string | null
  output_dir: string | null
  crop: CropRect | null
}

export interface StartedJob {
  id: string
  input: string
  kind: MediaKind
  preset: Preset
  custom: CustomParams | null
  crop: CropRect | null
}

export interface JobStartDeps {
  startJobs: (args: StartJobsArgs) => Promise<string[]>
  resolveSelection: (kind: MediaKind) => ResolvedPreset
  outputDir: () => string | null
  onJobs: (started: StartedJob[]) => void
  toast: (spec: ToastSpec) => void
}

// start_jobs applies one crop to the whole batch, so a cropped image cannot
// share a call with anything else.
export function groupStartBatches(items: StagedItem[]): StartBatch[] {
  const batches: StartBatch[] = []
  for (const item of items) {
    const open = item.crop === null
      ? batches.find(b => b.kind === item.kind && b.crop === null)
      : undefined
    if (open) {
      open.uids.push(item.uid)
      open.inputs.push(item.input)
    } else {
      batches.push({ kind: item.kind, crop: item.crop, uids: [item.uid], inputs: [item.input] })
    }
  }
  return batches
}

export async function startBatches(items: StagedItem[], deps: JobStartDeps): Promise<string[]> {
  const started: string[] = []
  // Sequential on purpose: start_jobs seeds its `claimed` output set from jobs
  // already in flight, so serialising is what stops a second crop of the same
  // source from overwriting the first one's file.
  for (const batch of groupStartBatches(items)) {
    const { preset, custom, slug } = deps.resolveSelection(batch.kind)
    let ids: string[]
    try {
      ids = await deps.startJobs({
        inputs: batch.inputs,
        preset,
        custom,
        slug,
        output_dir: deps.outputDir(),
        crop: batch.crop
      })
    } catch (e) {
      deps.toast({
        title: `Échec du démarrage (${batch.kind})`,
        description: String(e),
        color: 'error'
      })
      continue
    }
    const jobs: StartedJob[] = []
    batch.inputs.forEach((input, i) => {
      const id = ids[i]
      if (id) jobs.push({ id, input, kind: batch.kind, preset, custom, crop: batch.crop })
    })
    deps.onJobs(jobs)
    started.push(...batch.uids)
  }
  return started
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/jobStart.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/utils/jobStart.ts app/utils/jobStart.test.ts
git commit -m "feat(queue): add job start core with per-crop batching

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire the queue to staging

**Files:**
- Modify: `app/composables/useTranscodeQueue.ts`

**Interfaces:**
- Consumes: `startBatches`, `StartedJob`, `StartJobsArgs` from `~/utils/jobStart`; `StagedItem` from `~/types/job`.
- Produces: `queue.startStaged(items: StagedItem[]): Promise<string[]>`. Removes `addInputs`, `addCroppedInput` and `pickInputFiles` from the returned object.

- [ ] **Step 1: Replace the three entry points with one**

Delete `addInputs`, `addCroppedInput` and `pickInputFiles` and their entries in the returned object. Also delete the now-unused `splitIcloudStubs` / `icloudToast` / `toastIcloudStubs` imports and helper — staging owns that. Add:

```ts
  async function startStaged (items: StagedItem[]): Promise<string[]> {
    const m = new Map(state.value.jobs)
    const uids = await startBatches(items, {
      startJobs: args => invoke<string[]>('start_jobs', { args }),
      resolveSelection,
      outputDir: () => state.value.outputDir,
      onJobs: (started) => {
        for (const j of started) m.set(j.id, makeJob(j.id, j.input, '', j.preset, j.kind, j.custom, j.crop))
      },
      toast: spec => useToast().add(spec)
    })
    state.value.jobs = m
    return uids
  }
```

Add `startStaged` to the returned object. Keep `expand_paths` out of this file entirely.

- [ ] **Step 2: Verify nothing still calls the removed functions**

```bash
grep -rn "addInputs\|addCroppedInput\|pickInputFiles\|toastIcloudStubs" app/
```

Expected: hits only in `app/pages/index.vue` and `app/composables/useCropSession.ts`, which Tasks 8 and 9 fix. Note them and continue.

- [ ] **Step 3: Commit**

```bash
git add app/composables/useTranscodeQueue.ts
git commit -m "refactor(queue): replace drop entry points with startStaged

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Point the crop session at staging

**Files:**
- Modify: `app/utils/cropSession.ts`, `app/utils/cropSession.test.ts`, `app/composables/useCropSession.ts`

**Interfaces:**
- Consumes: `staging.setCrop` (Task 4/5), `cropPixelSize` (Task 3).
- Produces: `CropSessionDeps.setCrop(input, rect, cropPx)` replacing `addCroppedInput`.

- [ ] **Step 1: Update the test first**

In `app/utils/cropSession.test.ts`, rename the dep in the harness and assert the pixel size travels with the rect:

```ts
  const cropped: { input: string, rect: CropRect, cropPx: MediaSize }[] = []
  // ...in deps:
    setCrop: vi.fn((input: string, rect: CropRect, cropPx: MediaSize) => void cropped.push({ input, rect, cropPx })),
```

Return `cropped` from `harness` in place of `enqueued`, then update the three tests that used it:

- `'confirm enqueues once when called twice before the first returns'` — build the harness with `{ setCrop: vi.fn(() => { void gate.promise }) }` and assert `h.deps.setCrop` was called once. `setCrop` is synchronous now, so drop the `gate` and simply assert one call.
- `'setRatio refits the current frame and confirm passes that frame on'` — assert:

```ts
    await h.session.confirm()
    expect(h.cropped).toEqual([{ input: '/d/a.jpg', rect: c.rect, cropPx: cropPixelSize(c.rect, c.sourceW, c.sourceH) }])
```

Add a new test pinning the pixel size against a rotated source, where `sourceW`/`sourceH` come from the preview orientation:

```ts
  it('confirm reports the cropped pixel size from the oriented source', async () => {
    const h = harness()
    h.setProbed({ width: 4032, height: 3024 })
    h.setPreviewSize({ width: 900, height: 1200 })
    void h.session.open(['/d/portrait.heic'])
    await flush()
    await h.resolvePreview('/d/portrait.heic')
    h.session.setRect({ x: 0, y: 0, w: 0.5, h: 0.25 })
    await h.session.confirm()
    expect(h.cropped[0]?.cropPx).toEqual({ width: 1512, height: 1008 })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/utils/cropSession.test.ts`
Expected: FAIL — `setCrop` is not a recognised dep, `addCroppedInput` missing.

- [ ] **Step 3: Change the core**

In `app/utils/cropSession.ts`, in `CropSessionDeps`:

```ts
  setCrop: (input: string, rect: CropRect, cropPx: MediaSize) => void
```

and in `confirm`, replace the `await deps.addCroppedInput(...)` line:

```ts
    deps.setCrop(c.input, c.rect, cropPixelSize(c.rect, c.sourceW, c.sourceH))
```

Import `cropPixelSize` from `~/utils/cropGeometry` alongside the existing `applyRatio`, `initialRect`, `orientSourceSize`. `confirm` stays `async` — `loadNext` is still awaited.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/cropSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the wrapper**

In `app/composables/useCropSession.ts`, swap the queue dependency for staging:

```ts
export function useCropSession() {
  const state = useState<CropState>('wgr-clip-crop', initialCropState)
  const staging = useStaging()
  const toast = useToast()

  return createCropSession(state, {
    // ...unchanged deps...
    setCrop: staging.setCrop,
```

Delete the `useTranscodeQueue` import from this file.

- [ ] **Step 6: Stage images dropped onto the open editor**

`CropEditor` registers its own drop zone so images dropped on it join the session. Those images were never staged before, and `setCrop` only writes onto an item that exists — so without this they would be cropped and then silently vanish. Stage first, then open.

In `app/components/CropEditor.vue`:

```ts
const staging = useStaging()

// setCrop only writes onto a staged item, so a drop here must stage before
// it can be cropped — otherwise the file is silently dropped on confirm.
unregister = register({
  id: CROP_ZONE_ID,
  el: root,
  onDrop: paths => void staging.add(paths).then(() => crop.open(paths))
})
```

A video dropped here still gets staged for conversion and raises the existing "Images seulement" toast from the crop session — one toast, and the file is not lost.

- [ ] **Step 7: Run the full suite**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/utils/cropSession.ts app/utils/cropSession.test.ts app/composables/useCropSession.ts app/components/CropEditor.vue
git commit -m "feat(crop): confirm writes the rect onto the staged item

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Staged row and staging panel

**Files:**
- Create: `app/components/StagedRow.vue`, `app/components/StagingPanel.vue`

**Interfaces:**
- Consumes: `useStaging()`, `useTranscodeQueue().startStaged`, `useCropSession().open`, `StagedItem`.
- Produces: `<StagingPanel />`, self-contained — `index.vue` renders it with no props.

- [ ] **Step 1: Write StagedRow**

Create `app/components/StagedRow.vue`. An uncropped row shows no dimensions — staging never probes the source.

```vue
<script setup lang="ts">
import type { StagedItem } from '~/types/job'
import { basename } from '~/utils/format'

const props = defineProps<{ item: StagedItem }>()
const emit = defineEmits<{ crop: [], remove: [] }>()

const kindIcon: Record<StagedItem['kind'], string> = {
  video: 'i-lucide-film',
  image: 'i-lucide-image',
  audio: 'i-lucide-music'
}

const cropText = computed(() => {
  const px = props.item.cropPx
  return px ? `${px.width} × ${px.height} px` : ''
})
</script>

<template>
  <li class="row">
    <UIcon
      :name="kindIcon[item.kind]"
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
```

- [ ] **Step 2: Write StagingPanel**

Create `app/components/StagingPanel.vue`. Groups render in a fixed kind order so the layout does not jump as files arrive.

```vue
<script setup lang="ts">
import type { MediaKind } from '~/types/job'

const staging = useStaging()
const queue = useTranscodeQueue()
const crop = useCropSession()

const KIND_ORDER: MediaKind[] = ['video', 'image', 'audio']
const kindLabel: Record<MediaKind, string> = { video: 'Vidéos', image: 'Images', audio: 'Audio' }

const groups = computed(() =>
  KIND_ORDER
    .filter(k => staging.kinds.value.has(k))
    .map(kind => ({ kind, items: staging.items.value.filter(i => i.kind === kind) }))
)

const starting = ref(false)

const countLabel = computed(() => `${staging.count.value} fichier${staging.count.value > 1 ? 's' : ''}`)

async function convert() {
  starting.value = true
  try {
    staging.clear(await queue.startStaged(staging.items.value))
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section
    v-if="staging.count.value > 0"
    class="staging"
  >
    <header class="staging__head">
      <UIcon
        name="i-lucide-list-checks"
        class="staging__head-icon"
      />
      <span>Prêt à convertir</span>
      <span class="staging__count">{{ countLabel }}</span>
    </header>

    <div
      v-for="g in groups"
      :key="g.kind"
      class="staging__group"
    >
      <div class="staging__group-head">
        <span class="staging__group-label">{{ kindLabel[g.kind] }} ({{ g.items.length }})</span>
        <PresetSelector :kind="g.kind" />
        <UButton
          v-if="g.kind === 'image' && staging.uncroppedImages.value.length > 0"
          icon="i-lucide-crop"
          label="Recadrer"
          color="neutral"
          variant="outline"
          size="xs"
          @click="crop.open(staging.uncroppedImages.value)"
        />
      </div>
      <ul class="staging__rows">
        <StagedRow
          v-for="item in g.items"
          :key="item.uid"
          :item="item"
          @crop="crop.open([item.input])"
          @remove="staging.remove(item.uid)"
        />
      </ul>
    </div>

    <footer class="staging__actions">
      <UButton
        color="neutral"
        variant="ghost"
        @click="staging.clear()"
      >
        Tout effacer
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-play"
        :loading="starting"
        :disabled="starting"
        @click="convert()"
      >
        Convertir {{ countLabel }}
      </UButton>
    </footer>
  </section>
</template>

<style scoped>
.staging {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
}

.staging__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
}

.staging__head-icon {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--color-icterine-400);
}

.staging__count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  text-transform: none;
  letter-spacing: 0;
}

.staging__group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px solid #2a2a2a;
}

.staging__group:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.staging__group-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.staging__group-label {
  font-weight: 700;
  font-size: 0.78rem;
  color: #FDF7F1;
  margin-right: auto;
}

.staging__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.staging__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
```

- [ ] **Step 3: Verify lint and types**

```bash
npm run lint && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/StagedRow.vue app/components/StagingPanel.vue
git commit -m "feat(staging): add staging panel and row components

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Rewire the page to a single drop zone

**Files:**
- Modify: `app/pages/index.vue`, `app/components/DropZone.vue`, `app/components/CustomParamsPanel.vue`

- [ ] **Step 1: Add the compact variant to DropZone**

In `app/components/DropZone.vue`, extend the props and hide the hint when compact:

```ts
const props = defineProps<{ id: string, title: string, hint: string, icon: string, compact?: boolean }>()
```

```vue
  <button
    ref="el"
    type="button"
    class="dropzone"
    :class="{ 'dropzone--hover': isHover, 'dropzone--compact': compact }"
```

and hide the hint paragraph with `v-if="!compact"`. Add:

```css
.dropzone--compact {
  min-height: 74px;
  padding: 0.75rem 1rem;
}

.dropzone--compact .dropzone__icon {
  width: 1.25rem;
  height: 1.25rem;
  margin-bottom: 0;
}

.dropzone--compact .dropzone__title {
  font-size: 0.95rem;
}
```

- [ ] **Step 2: Rewrite the page**

Replace `app/pages/index.vue`'s script and template. `CROP_ZONE_ID` is no longer a zone on this page — `CropEditor` registers it itself.

```vue
<script setup lang="ts">
import { CONVERT_ZONE_ID } from '~/composables/useDropTargets'

useHead({ title: 'wgr-clip' })

const staging = useStaging()
const crop = useCropSession()
const settingsOpen = ref(false)

function reportError(e: unknown) {
  console.error('[index] drop failed', e)
  useToast().add({ title: 'Erreur', description: String(e), color: 'error' })
}

function onDrop(paths: string[]) {
  staging.add(paths).catch(reportError)
}
</script>

<template>
  <div class="page">
    <UpdateBanner />

    <section class="page__topbar">
      <h1 class="page__title">
        clip
      </h1>
      <UButton
        icon="i-lucide-settings-2"
        color="neutral"
        variant="ghost"
        aria-label="Réglages"
        @click="settingsOpen = true"
      />
    </section>

    <CropEditor v-if="crop.active.value" />
    <DropZone
      v-else
      :id="CONVERT_ZONE_ID"
      title="Déposez ou cliquez pour parcourir"
      hint="Vidéos, images, audio. Compression web en un drag."
      icon="i-lucide-arrow-down-to-line"
      :compact="staging.count.value > 0"
      @drop="onDrop"
      @click="staging.pickFiles()"
    />

    <StagingPanel />
    <CustomParamsPanel />
    <JobList />

    <SettingsPanel v-model:open="settingsOpen" />
  </div>
</template>
```

Keep the existing `<style scoped>` block, deleting only the now-unused `.page__zones` rule.

- [ ] **Step 3: Filter CustomParamsPanel by what is staged**

In `app/components/CustomParamsPanel.vue`, add `const staging = useStaging()` and gate each group on both conditions:

```ts
const showVideo = computed(() => staging.kinds.value.has('video') && queue.videoPreset.value === 'custom')
const showImage = computed(() => staging.kinds.value.has('image') && queue.imagePreset.value === 'custom')
const showAudio = computed(() => staging.kinds.value.has('audio') && queue.audioPreset.value === 'custom')
```

Leave the rest of the component alone.

- [ ] **Step 4: Verify lint and types**

```bash
npm run lint && npm run typecheck
```

Expected: clean, except an unresolved `SettingsPanel` which Task 11 creates. If typecheck fails only on that, continue.

- [ ] **Step 5: Commit**

```bash
git add app/pages/index.vue app/components/DropZone.vue app/components/CustomParamsPanel.vue
git commit -m "feat(ui): single drop zone feeding the staging panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Settings panel

**Files:**
- Create: `app/components/SettingsPanel.vue`
- Modify: `app/components/PresetSelector.vue`
- Delete: `app/components/PresetManagerModal.vue`, `app/components/DestinationPicker.vue`

- [ ] **Step 1: Write SettingsPanel**

Create `app/components/SettingsPanel.vue`, absorbing the destination picker and the preset manager body. `version` and "Journaux" stay in `AppFooter` — do not duplicate them.

```vue
<script setup lang="ts">
import type { MediaKind } from '~/types/job'
import { basename } from '~/utils/format'
import { describeUserPreset } from '~/utils/userPresets'

const open = defineModel<boolean>('open', { required: true })

const queue = useTranscodeQueue()
const userPresets = useUserPresets()

const destLabel = computed(() => {
  const d = queue.outputDir.value
  if (!d) return 'Même dossier que la source'
  return basename(d) || d
})

const kindIcon: Record<MediaKind, string> = {
  video: 'i-lucide-film',
  image: 'i-lucide-image',
  audio: 'i-lucide-music'
}
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Réglages"
    description="Destination des fichiers convertis et presets importés."
  >
    <template #body>
      <section class="settings__block">
        <h3 class="settings__title">
          Destination
        </h3>
        <button
          type="button"
          class="settings__dest"
          :title="queue.outputDir.value ?? 'Même dossier que le fichier d\'entrée'"
          @click="queue.pickOutputDir()"
        >
          <UIcon
            name="i-lucide-folder-output"
            class="settings__dest-icon"
          />
          <strong class="settings__dest-label">{{ destLabel }}</strong>
        </button>
      </section>

      <section class="settings__block">
        <h3 class="settings__title">
          Presets importés
        </h3>
        <p class="settings__hint">
          Réglages nommés chargés depuis un fichier JSON. Ils apparaissent dans les menus de leur type et restent disponibles au prochain lancement.
        </p>
        <ul
          v-if="userPresets.presets.value.length > 0"
          class="settings__list"
        >
          <li
            v-for="p in userPresets.presets.value"
            :key="p.id"
            class="settings__row"
          >
            <UIcon
              :name="kindIcon[p.kind]"
              class="settings__row-icon"
            />
            <span class="settings__row-text">
              <strong class="settings__row-name">{{ p.name }}</strong>
              <span class="settings__row-hint">{{ describeUserPreset(p) }} · suffixe <code>_{{ p.id }}</code></span>
            </span>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Supprimer ${p.name}`"
              @click="userPresets.remove(p.id)"
            />
          </li>
        </ul>
        <p
          v-else
          class="settings__hint"
        >
          Aucun preset importé pour l'instant.
        </p>
        <UButton
          icon="i-lucide-file-json-2"
          label="Importer un fichier JSON…"
          color="neutral"
          variant="outline"
          size="xs"
          @click="userPresets.importFromFile()"
        />
      </section>
    </template>
  </USlideover>
</template>

<style scoped>
.settings__block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #2a2a2a;
}

.settings__block:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}

.settings__title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
  margin: 0;
}

.settings__hint {
  font-size: 0.75rem;
  color: #888;
  line-height: 1.4;
  margin: 0;
}

.settings__dest {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.8rem;
  color: inherit;
  max-width: 100%;
}

.settings__dest:hover {
  border-color: #3a3a3a;
}

.settings__dest-icon {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--color-icterine-400);
  flex-shrink: 0;
}

.settings__dest-label {
  color: #FDF7F1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__list {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-top: 1px solid #2a2a2a;
}

.settings__row:first-child {
  border-top: 0;
  padding-top: 0;
}

.settings__row-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--color-icterine-400);
}

.settings__row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.settings__row-name {
  font-size: 0.82rem;
  color: #FDF7F1;
}

.settings__row-hint {
  font-size: 0.72rem;
  color: #888;
  line-height: 1.3;
}

.settings__row-hint code {
  font-size: 0.7rem;
  color: #aaa;
}
</style>
```

- [ ] **Step 2: Drop the manage entry from the preset dropdown**

In `app/components/PresetSelector.vue`: delete the `MANAGE` constant, `manageOption`, the `groups.push([manageOption])` line, the `icon` field on `PresetOption`, the `useUserPresets()`-driven `openManager` branch in the `selected` setter (it becomes `set: v => queue.setPreset(props.kind, v.value)`), and the `UIcon` in the `#item` slot. Keep the imported-presets group and the popover `max-height` override. The `value` type narrows back to `PresetSelection`.

- [ ] **Step 3: Delete the two replaced components**

```bash
git rm app/components/PresetManagerModal.vue app/components/DestinationPicker.vue
grep -rn "PresetManagerModal\|DestinationPicker\|openManager\|managerOpen" app/
```

Expected: no hits left. If `managerOpen`/`openManager` remain in `useUserPresets.ts`, remove them and their state field — nothing opens a manager any more.

- [ ] **Step 4: Verify lint, types and the whole suite**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add -A app/components app/composables/useUserPresets.ts
git commit -m "feat(ui): move destination and preset management into a settings panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Manual verification and docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Run the app and walk the flow**

```bash
npm run tauri:dev
```

Check each of these:

1. Drop a folder holding videos, images and audio → three groups appear, each with its own preset pill; the drop zone shrinks.
2. A second drop of the same folder adds nothing (dedupe).
3. Set the image preset to "Personnalisé…" → only the Image group of `CustomParamsPanel` appears. Set the video pill too → two groups. Remove every video row → the Video group disappears from the panel.
4. "Recadrer" on the Images group → editor opens on the first uncropped image, staging panel stays visible, each confirm adds a `⬚ w × h px` badge. Press it again → it offers only images with no badge.
5. A per-row crop button on an already-cropped image reopens it with a fresh frame.
6. "Convertir" → jobs appear in `JobList`, staging empties. Cropped outputs carry `_crop_`, uncropped ones do not.
7. Drop an `.icloud` placeholder → the Finder toast, nothing staged.
8. `[⚙]` → change the destination, import `presets/example.json`, delete a preset. Relaunch → destination and presets persisted, the preset dropdowns no longer show "Gérer les presets…".
9. Drop images onto the open crop editor → they join the session.

- [ ] **Step 2: Update README**

Replace the paragraph starting "3 presets per kind" and the "**Recadrer**" paragraph with:

```markdown
A drop stages files instead of converting them straight away: they land in a "Prêt à convertir" list grouped by kind, each group carrying its own preset (Original / Web / High Quality / Personnalisé, plus any preset imported from JSON). One button converts the batch.

**Recadrer** : staged images can be cropped before conversion — from the group header for every image still uncropped, or per row for one of them. Free frame or 1:1 · 4:5 · 3:2 · 16:9 · 9:16 locks. The crop runs before the preset's resize; output is `<name>_crop_<preset>.jpg`.

Output destination and imported presets live behind the settings button.
``` In the "Project layout" block, add `StagingPanel.vue`, `StagedRow.vue`, `SettingsPanel.vue`, `staging.ts`, `jobStart.ts`, `mediaKind.ts`, `useStaging.ts`, and drop the lines for `PresetManagerModal.vue` and `DestinationPicker.vue`.

- [ ] **Step 3: Update CLAUDE.md**

- In "Where things live", note that staging lives in `app/utils/staging.ts` + `useStaging.ts`, and that `detectKind` and the extension lists moved to `app/utils/mediaKind.ts`.
- In "Critical gotchas", add: **`start_jobs` takes one crop for the whole batch.** `jobStart.ts` therefore issues one call per `(kind, crop)` and awaits them **sequentially** — `claimed` is seeded from in-flight jobs, so serialising is what stops a second crop of the same source from overwriting the first's output.
- In "Common tasks", replace the crop-ratio and preset-label entries' surrounding context where it still says two drop zones.
- Remove "History / recent jobs persistence" from "Out of scope" only if you added it — otherwise leave that section, and add `Staging is not persisted across launches`.

- [ ] **Step 4: Full verification**

```bash
npm test && npm run lint && npm run typecheck && (cd src-tauri && cargo test)
```

Expected: JS suite green (including `mediaKind`, `staging`, `jobStart`, `cropSession`, `userPresets`), lint and typecheck clean, 12 Rust tests still passing — no Rust file was touched.

- [ ] **Step 5: Commit and open the PR**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the unified staging flow

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin <branch>
gh pr create --title "feat(ui): unified drop → adjust → run flow" --body-file <(printf '%s\n' "A drop now stages files instead of encoding them. Preset and crop are attributes of the same staged batch, global settings moved behind one panel, and a failed group stays staged so it can be retried." "" "Spec: docs/superpowers/specs/2026-09-28-unified-flow-design.md" "Plan: docs/superpowers/plans/2026-09-28-unified-flow.md" "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
```
