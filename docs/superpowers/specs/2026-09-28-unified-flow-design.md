# Unified flow — design

Date: 2026-09-28
Status: approved in chat, pending written review

## Goal

Merge the two features built in separate sessions — per-kind presets (with imported JSON presets) and the crop editor — into one flow: **drop → adjust → run**. A drop stops starting the encode; it stages files. Preset and crop become two attributes of the same staged batch, reachable from one screen, in any order, before anything is encoded.

## Problem

1. `app/pages/index.vue` renders two drop zones, so the user picks "convert or crop" *before* dropping. Cropping is a modifier on an image conversion, not a rival intent, and the crop zone only accepts images — the decision is forced at the worst possible moment.
2. Three `PresetSelector` pills are always visible; at most one matters for a given drop. They are global settings dressed up as job controls.
3. `CustomParamsPanel` can render three parameter groups at once.
4. `addInputs` and `cropSession.confirm` both reach `start_jobs` immediately. There is no moment to check what was dropped, and no way to change the preset after seeing the crop frame.
5. Nothing composes. A file dropped on the convert zone can never be cropped.
6. On `worktree-feat-preset-import`, preset management hides inside a `USelectMenu` item that opens a modal — a third separate surface.

## Scope

In scope:

- A staging layer: dropped files land as `StagedItem`s and wait. Nothing is encoded until the user presses "Convertir".
- One drop zone. Click still opens the media file picker.
- `PresetSelector` pills render only for the media kinds actually present in staging. `CustomParamsPanel` renders only groups that are both present and set to `custom`.
- Crop reached from the staging panel: a group-level "Recadrer" button (every image not yet cropped) or a per-row button (one image). Confirming writes the rect onto the staged item instead of starting a job.
- A settings slideover behind one `[⚙]` button: output destination and imported-preset management.
- A group whose `start_jobs` call fails stays in staging, so it can be retried.

Out of scope:

- Per-file preset override. The preset stays per kind, persisted, as today.
- Video or audio cropping. `preset.rs` only wires the crop filter into `image_args`.
- Reordering staged items; persisting staging across launches; re-cropping an already finished job.
- Version bump and release — normal release flow.

## Sequencing

Two chantiers, two PRs.

### Chantier 0 — land the preset branch

Rebase `worktree-feat-preset-import` (4 commits, tip `c1830b2`) onto master and merge, with **no UX rework**. Expected conflicts:

- `app/pages/index.vue` — the branch is based on the single-zone index from before the crop editor.
- `app/components/CustomParamsPanel.vue`, `app/types/job.ts`, `app/composables/useTranscodeQueue.ts`.

`PresetManagerModal.vue` lands as-is and is deleted again in chantier 1; that waste is accepted to unblock the branch's backend work.

Baseline this establishes, which chantier 1 assumes: `PresetSelection = Preset | user:${string}`, `CustomParams` carrying both a width and a height per kind, fit-inside-box scaling, and the user-preset output slug.

### Chantier 1 — the unified flow

Everything below, on top of that baseline.

## User flow

1. The screen shows the title, a `[⚙]` button, and one drop zone.
2. The user drops files or folders, or clicks to pick them. iCloud placeholders and unsupported files are dropped with the existing toasts.
3. Survivors appear under "Prêt à convertir · N fichiers", grouped by media kind. Each group shows its preset pill; only kinds present get one. The drop zone shrinks but stays available — more drops append.
4. For images, "Recadrer" on the group header opens the crop editor over every staged image **that has no crop yet**, in order; the per-row button opens it for that one image, cropped or not. Re-opening an already-cropped image starts from a fresh rect — restoring the stored one would mean threading an initial rect through `loadNext`, and is deliberately out of scope. The editor replaces the drop zone, and **the staging panel stays visible** so badges appear as each crop is confirmed. "Passer" and "Annuler" behave as today.
5. "Convertir N fichiers" starts everything. Staged rows leave, jobs appear in `JobList` unchanged.
6. If a group fails to start, its items stay staged with a toast, and the button can be pressed again.

"Tout effacer" empties staging only. It never touches `JobList`, which keeps its own `clearFinished`.

## Architecture

### Shared type

`app/types/job.ts`:

```ts
export interface StagedItem {
  /** Client-side id. Staging has no backend id — those come from start_jobs. */
  uid: string
  input: string
  kind: MediaKind
  crop: CropRect | null
  /** Result size in px, filled at confirm time so the row can show a badge. */
  cropPx: MediaSize | null
}
```

No preset field: the preset is resolved per kind at start time from the persisted settings. This keeps the type small and avoids a second copy of preset state.

`cropPx` exists so a staged row never needs the *source* dimensions. Showing those would mean one `probe_media_size` call per staged file, which a 40-file folder drop cannot afford; the crop session already knows `sourceW`/`sourceH` at confirm time and hands the computed result size over. An uncropped row therefore shows no dimensions at all.

### Frontend modules

- **`app/utils/staging.ts`** (new) — pure core with injected deps, matching the `cropSession.ts` / `dropDispatcher.ts` convention so Vitest covers it.
  - State: `{ items: StagedItem[] }`.
  - Deps: `expandPaths`, `detectKind`, `toast`, `newUid`.
  - API: `add(rawPaths)` (split iCloud stubs → `expand_paths` → dedupe by `input` → append), `remove(uid)`, `clear(uids?)`, `setCrop(input, rect, cropPx)`.
  - Derived: `items`, `count`, `kinds` (Set of kinds present, drives which pills render), `uncroppedImages` (the group-level button only offers images with no crop yet).
- **`app/composables/useStaging.ts`** (new) — thin wrapper: `useState<StagingState>('wgr-clip-staging', …)` plus `invoke('expand_paths')`, `detectKind`, `useToast()`, `crypto.randomUUID`.
- **`app/composables/useTranscodeQueue.ts`** — loses `addInputs` and `addCroppedInput` from the drop path, gains `startStaged(items): Promise<string[]>` returning the uids that started. Listeners, `counts`, `cancel`, `retry`, settings persistence and `pickInputFiles` (which now feeds staging) are untouched.
- **`app/utils/cropSession.ts`** — the injected dep `addCroppedInput(input, rect)` becomes `setCrop(input, rect, cropPx)`, and `confirm` computes `cropPx` from the rect and the `sourceW`/`sourceH` it already holds. One line in the core, one in the wrapper. The pending queue, `skip`, and the `gen` staleness guard are unchanged.

### Components

| Component | Change |
|---|---|
| `StagingPanel.vue` | new — header, one group per kind present (pill + "Recadrer" for images), rows, footer actions |
| `StagedRow.vue` | new — kind icon, basename, crop badge when cropped, crop button (images), remove |
| `SettingsPanel.vue` | new — `USlideover`: output destination row, imported presets list (import / delete) |
| `index.vue` | topbar reduced to title + `[⚙]`; one `DropZone`; `StagingPanel` above `JobList` |
| `CustomParamsPanel.vue` | renders a group only when that kind is staged **and** its preset is `custom` |
| `PresetSelector.vue` | the "Gérer les presets…" item is removed — management lives in `[⚙]` |
| `DropZone.vue` | gains a `compact` prop: reduced `min-height`, hint paragraph hidden, title kept |
| `PresetManagerModal.vue` | deleted, body absorbed into `SettingsPanel` |
| `DestinationPicker.vue` | deleted as a topbar pill, its content becomes a row in `SettingsPanel` |
| `JobList.vue`, `JobRow.vue`, `CropEditor.vue`, `AppFooter.vue` | unchanged |

`AppFooter` already carries version and "Journaux", so the settings panel does not repeat them.

### Screen layout

```
clip                                             [⚙]
┌───────────────────────────────────────────────────┐
│  ⤓  Déposez ou cliquez pour parcourir             │  ← compact when staging non-empty;
└───────────────────────────────────────────────────┘    replaced by CropEditor during a session
Prêt à convertir · 12 fichiers
  Images (12)   [Web 2000px ▾]   [Recadrer]
    IMG_001.heic                              [⬚] ✕
    IMG_002.heic   ⬚ 3024 × 3024 px          [⬚] ✕
  ⚙ Réglages personnalisés — Image             (only if the image preset is custom)
                        [Tout effacer]  [Convertir 12 fichiers]
───────────────────────────────────────────────────
File d'attente   (JobList, unchanged)
```

## Data flow

```
drop / click ──→ staging.add(paths)              iCloud split, expand_paths, dedupe
                      ↓
        StagingPanel: pills for present kinds only
                      ↓  "Recadrer" (group) or row button
crop.open(inputs) ──→ CropEditor ──→ confirm ──→ staging.setCrop(input, rect, cropPx) ──→ loadNext()
                      ↓
        "Convertir N" ──→ queue.startStaged(items) ──→ staging.clear(startedUids)
                      ↓
        JobList (unchanged)
```

`useDropTargets` and `dropDispatcher` are untouched. At most one zone is registered at a time: the editor replaces the drop zone while a session is open, and it registers `CROP_ZONE_ID` itself so images dropped on the editor join the session — today's behaviour.

## Job start and the batch-crop constraint

`start_jobs` takes **one** `crop` for the whole batch (`src-tauri/src/commands.rs:159-163`). So `startStaged` groups staged items by `(kind, crop)`: one call per kind for the uncropped items, and one call per cropped image. No Rust change.

Those calls must be **sequential** — `await` one after the other, never `Promise.all`. `claimed` is seeded from jobs already Pending / Probing / Encoding (`commands.rs:145-151`), so serialising is exactly what keeps a second crop of the same source from overwriting the first. This needs a comment in the code: it is the kind of non-obvious WHY the repo conventions ask for.

`startStaged` collects the uids of every group that started and returns them; the caller clears only those.

## Error handling

| Case | Behaviour |
|---|---|
| `expand_paths` fails | toast, staging unchanged |
| No supported file | toast listing what was received (current message kept) |
| `.icloud` placeholders | existing `icloudToast`, now raised at staging time |
| Non-image dropped during a crop session | existing "Images seulement" toast from `cropSession` |
| Crop preview fails | existing toast, then skip to the next image |
| `start_jobs` fails for a group | toast, and that group's items **stay staged**. Retryable — today the batch is lost. |

## Testing

- `app/utils/staging.test.ts` (new): dedupe by `input`; iCloud stubs filtered and toasted; folder expansion; `setCrop` writes rect and `cropPx` on the matching item and leaves siblings alone; `remove` / `clear(uids)`; `kinds` reflects content.
- `app/utils/cropSession.test.ts`: dep renamed; `confirm` now asserts the rect is written rather than a job started.
- Unchanged: `cropGeometry`, `dropHitTest`, `dropDispatcher`, `editorKeys`, `icloud`, `userPresets`.
- `cargo test` unchanged — no Rust modification in chantier 1.
- Manual: mixed folder → only relevant pills; crop 2 of 5 images → `_crop_` suffix on those 2 only; simulated `start_jobs` failure → items kept.

## Files

New: `app/utils/staging.ts`, `app/utils/staging.test.ts`, `app/composables/useStaging.ts`, `app/components/StagingPanel.vue`, `app/components/StagedRow.vue`, `app/components/SettingsPanel.vue`.

Modified: `app/pages/index.vue`, `app/components/CustomParamsPanel.vue`, `app/components/PresetSelector.vue`, `app/components/DropZone.vue`, `app/composables/useTranscodeQueue.ts`, `app/composables/useCropSession.ts`, `app/utils/cropSession.ts`, `app/utils/cropSession.test.ts`, `app/types/job.ts`, `README.md`, `CLAUDE.md`.

Deleted: `app/components/PresetManagerModal.vue`, `app/components/DestinationPicker.vue`.

## Working notes

- `createCropSession` already receives its job-starting dep by injection (`app/composables/useCropSession.ts:37`), which is why repointing crop at staging is a dep swap rather than a rewrite.
- `useTranscodeQueue.ts` is the largest frontend file at 400 lines. Staging deliberately lives outside it, both to keep it from growing and because a staged item has no backend id while a job does — mixing them would blur the Rust ↔ JS contract.
- A `Job` with `status: 'staged'` was considered and rejected for that reason: ids come from `start_jobs`, so staged jobs would need fake ids and `patch(id)` would become ambiguous.
