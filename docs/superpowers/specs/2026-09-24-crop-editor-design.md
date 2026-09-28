# Crop editor — design

Date: 2026-09-24
Status: approved in chat, pending written review

## Goal

Let a user drop an image on a dedicated "Recadrer" zone, draw the region to keep on a preview, and get the cropped result through the normal image pipeline (resize + JPEG per the current image preset). Images only. Video and audio are out of scope.

## Scope

In scope:

- A second drop zone, "Recadrer", next to the existing one. Click opens an image-only file picker.
- An inline crop editor replacing both drop zones while a crop session is open. Free rectangle with ratio locks (1:1, 4:5, 3:2, 16:9, 9:16), 8 resize handles, move by dragging, pixel-size readout.
- Several images dropped at once are edited one after the other. "Passer" skips the current one.
- The cropped job runs with the current image preset (Original / Web / HD / Personnalisé), so crop happens before the existing scale + JPEG step.
- Output named `<stem>_crop_<preset-slug>.jpg`, same collision rule as today (`_2`, `_3`, ...).

Out of scope:

- Video or audio cropping. Non-images dropped on the crop zone are refused with a toast.
- Rotation, flip, straighten.
- Persisting crop rectangles between sessions.
- Crop-from-job-row (re-crop an already queued file).
- Version bump and release; handled by the normal release flow.

## User flow

1. The main screen shows two zones side by side: "Déposez ou cliquez pour parcourir" (existing compression flow) and "Recadrer".
2. The user drops one or more files on "Recadrer" (or clicks it and picks images).
3. Non-image files are dropped from the list with a warning toast. iCloud placeholders get the existing "Fichier iCloud non téléchargé" toast. If nothing is left, nothing happens.
4. The two zones are replaced by the editor for the first image: file name, "1/N" counter, preview, crop frame, ratio chips, pixel readout, buttons "Recadrer et convertir", "Passer" (only when more images wait) and "Annuler".
5. "Recadrer et convertir" enqueues the job and moves to the next image. The job appears in the queue below with the status label "Recadrage".
6. When the last image is confirmed or skipped, or on "Annuler", the editor closes and the two zones come back. "Annuler" drops every remaining image.
7. Enter confirms, Escape cancels the whole session.

A drop anywhere else in the window keeps today's behavior: straight compression.

## Architecture

### Shared type

```
CropRect { x, y, w, h }   // fractions of the source image, 0..1
```

Rust: `#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)] pub struct CropRect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }` in `transcode/mod.rs`.
TypeScript: `interface CropRect { x: number, y: number, w: number, h: number }` in `app/types/job.ts`.

Fractions rather than pixels: the rectangle is drawn on a downscaled preview and applied to the full-size source, and both go through the same ffmpeg decoder, so orientation and dimensions stay consistent without the frontend knowing the source size.

No validation on the Rust side. The rectangle comes from the editor, whose geometry module keeps it inside the image and above the minimum size. That is the user-input boundary.

### Backend

**Job model.** `Job` gains `crop: Option<CropRect>`. `StartJobsArgs` gains `#[serde(default)] crop: Option<CropRect>` that applies to every input of the call; the frontend sends one input per call for cropped jobs. `JobQueue::enqueue`, the dispatcher snapshot, `retry_job`, `get_diagnostics`, `encoder::run_job`, `try_encode` and `preset::build_args` carry the field through.

**Filter.** `preset::image_args` takes `crop: Option<CropRect>`. When present, the video filter chain becomes `crop=<expr>,scale=<existing>` (or `crop=<expr>` alone when the preset has no max dimension). The crop expression, built by `crop_filter(rect)`:

```
crop=trunc(iw*W/2)*2:trunc(ih*H/2)*2:trunc(iw*X):trunc(ih*Y)
```

with W, H, X, Y formatted with six decimals. Width and height are forced even for the yuvj420p output. `video_args` and `audio_args` ignore the field.

**Output naming.** `encoder::resolve_output_path` takes `cropped: bool`. Base name is `<stem>_crop_<slug>` when true, `<stem>_<slug>` otherwise. The collision loop is unchanged.

**Command `render_crop_preview(input: PathBuf) -> Result<tauri::ipc::Response, AppError>`** (async, `commands.rs`). Spawns the ffmpeg sidecar with `set_raw_out(true)` and:

```
-hide_banner -loglevel error -i <input>
-vf scale='if(gte(iw,ih),min(1200,iw),-2)':'if(gte(iw,ih),-2,min(1200,ih))'
-frames:v 1 -f image2pipe -c:v mjpeg -q:v 4 -pix_fmt yuvj420p pipe:1
```

Stdout chunks are concatenated into the JPEG bytes and returned as `Response::new(bytes)`, which the frontend receives as an `ArrayBuffer`. A non-zero exit returns `AppError::Other(stderr)`. The preview runs outside the encode queue: it is short and must not wait behind a long video job.

**Command `probe_media_size(input: PathBuf) -> Result<MediaSize, AppError>`** (async). Calls the existing `probe()` and returns `{ width, height }`. Used for the pixel readout only.

Both commands are registered in `lib.rs`. No capability change: they are core commands and the sidecar permission already covers ffmpeg and ffprobe. No new Cargo dependency.

### Frontend

**`useDropTargets` (new composable).** Owns the single `getCurrentWebview().onDragDropEvent` listener, moved out of `DropZone.vue`. Zones register `{ id, el, onDrop(paths) }` and get an unregister function for unmount. On `enter` and `over`, the physical `position` is divided by `window.devicePixelRatio` and hit-tested against each registered element's `getBoundingClientRect()`; the matching id becomes `hoveredId`. On `drop`, the hit zone's `onDrop` runs; when no zone matches, the `convert` zone's handler runs so dropping anywhere in the window still compresses. On `leave`, `hoveredId` is cleared. Attach failure shows the existing "Drag-drop indisponible" toast; an empty `paths` array shows the existing "Drop vide" toast.

**`DropZone.vue` (refactored).** Presentational: props `id`, `title`, `hint`, `icon`; emits `drop(paths)` and `click`. Registers itself with `useDropTargets` and renders the hover state from `hoveredId === id`. `index.vue` mounts two instances in a flex row (wrap allowed):

- `convert`: existing texts and icon; drop → `queue.addInputs`, click → `queue.pickInputFiles`.
- `crop`: title "Recadrer", hint "Déposez une image, choisissez le cadre.", icon `i-lucide-crop`; drop → `cropSession.open`, click → `cropSession.pickImages` (dialog filtered to `IMAGE_EXTS`).

**`useCropSession` (new composable, `useState('wgr-clip-crop')`).** State: `pending: string[]`, `current: { input, previewUrl, rect, ratio, sourceW, sourceH } | null`, `loading: boolean`. API:

- `open(paths)`: filters out iCloud stubs (shared helper extracted from `addInputs`) and non-images (`detectKind !== 'image'`, exported from `useTranscodeQueue`), toasts for each rejected group, appends survivors to `pending`, and loads the first when no `current`.
- `loadCurrent()`: invokes `render_crop_preview` and `probe_media_size`, builds a `Blob` and object URL, sets `rect = initialRect(ratio, sourceW / sourceH)`.
- `setRatio(r)`: stores the lock and refits the current rect with `applyRatio`.
- `confirm()`: `queue.addCroppedInput(current.input, current.rect)`, then `advance()`.
- `skip()`: `advance()`.
- `close()`: clears `pending` and `current`.
- `advance()` and `close()` revoke the object URL.

`useTranscodeQueue.addCroppedInput(input, rect)` invokes `start_jobs` with `inputs: [input]`, the current image preset, the custom params when the preset is `custom`, the output dir and `crop: rect`, then inserts the job with `crop` set. `makeJob` gains the `crop` field.

**`app/utils/cropGeometry.ts` (pure).** Works in fractions; ratio locks are expressed in pixel terms, so functions that touch the ratio take `imageAspect = sourceW / sourceH`. A ratio `r` (width / height in pixels) maps to `h = w * imageAspect / r` in fractions.

- `initialRect(ratio, imageAspect)`: centered box covering 80% of the image, refit to the ratio when locked.
- `moveRect(rect, dx, dy)`: translate, then clamp inside `[0, 1]`.
- `resizeRect(rect, handle, dx, dy, ratio, imageAspect)`: `handle` is one of `n s e w ne nw se sw`. Free mode moves the named edges. Locked mode drives width from the drag (height for `n`/`s`) and derives the other dimension, anchored on the opposite edge or corner. The result respects `MIN_SIZE = 0.02` on both axes and stays inside the image; when a derived dimension would overflow, the driving dimension is reduced instead.
- `applyRatio(rect, ratio, imageAspect)`: keep the center and the width, derive the height, shrink the width if the height overflows, then clamp.

**`CropEditor.vue` (new).** Layout: header with file name and "i/N"; a wrapper `display: inline-block; position: relative` around the preview `<img>` (`display: block; max-width: 100%; max-height: 420px`) so the overlay `inset: 0` matches the rendered image exactly; the crop frame positioned in percentages from the rect, darkened outside via `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` with `overflow: hidden` on the wrapper; 8 handles; pointer events (`pointerdown` on frame or handle, `pointermove` and `pointerup` on `window`, deltas divided by the wrapper's rendered size). Ratio chips as a `UButton` group: Libre, 1:1, 4:5, 3:2, 16:9, 9:16. Readout: `round(rect.w * sourceW) × round(rect.h * sourceH) px`. Buttons: "Recadrer et convertir" (icterine accent), "Passer" when `pending.length > 0`, "Annuler". Keyboard: Enter confirms, Escape closes. A spinner replaces the preview while `loading`.

`index.vue` renders `CropEditor` instead of the two zones when `cropSession.current` is set. The custom params panel and the job list stay where they are. Window height follows through `useAutoFit`.

**`JobRow.vue`.** For image jobs, the "encoding" status label reads "Recadrage" when `job.crop` is set, "Compression" otherwise.

## Data flow

```
drop on "Recadrer"
  → useDropTargets hit-test → cropSession.open(paths)
  → filter (icloud, non-image) → pending
  → loadCurrent: invoke render_crop_preview + probe_media_size
      → Blob → object URL → <img>
  → user drags frame (cropGeometry keeps rect valid)
  → confirm → queue.addCroppedInput(input, rect)
      → invoke start_jobs { inputs:[input], preset, custom, output_dir, crop }
      → Rust enqueue(job with crop) → run_job → build_args
          → image_args: -vf crop=...,scale=... → <stem>_crop_<slug>.jpg
      → transcode://progress / done events as today
  → advance to next pending or close
```

## Error handling

- Preview or size probe failure: toast "Aperçu impossible" with the first stderr line, then `advance()` to the next image.
- Non-image or iCloud stub dropped on the crop zone: warning toast, file ignored.
- `start_jobs` failure: existing "Échec du démarrage (image)" toast; the session still advances.
- ffmpeg failure during the cropped encode: existing `JobError` classification and error panel; diagnostics rebuild the argv with the crop so the copied report matches what ran.
- No new `JobError` variant.

## Testing

- **Vitest** (new devDependency, `npm test`): `app/utils/cropGeometry.test.ts` covers `initialRect` free and locked, `moveRect` clamping at every edge, `resizeRect` for each of the 8 handles in free mode, minimum size, ratio preservation in locked mode with a non-square image, overflow handling, and `applyRatio` refit.
- **Rust** (`cargo test` in `src-tauri`, first tests in the crate): `crop_filter` expression formatting, `image_args` ordering `crop=...,scale=...` and crop-only when the preset has no max dimension, `resolve_output_path` with `cropped = true`.
- **Manual** in `npm run tauri:dev`: JPEG, HEIC, AVIF, an iPhone portrait photo (orientation consistency between preview and output), ratio lock on a landscape and a portrait image, three images dropped at once with one skipped, a video and an audio file dropped on "Recadrer", a drop outside both zones, click on each zone, Enter and Escape.

## Files

New:

- `app/composables/useDropTargets.ts`
- `app/composables/useCropSession.ts`
- `app/utils/cropGeometry.ts`, `app/utils/cropGeometry.test.ts`
- `app/components/CropEditor.vue`

Modified:

- `app/components/DropZone.vue`, `app/pages/index.vue`, `app/components/JobRow.vue`
- `app/composables/useTranscodeQueue.ts`, `app/types/job.ts`
- `src-tauri/src/transcode/mod.rs`, `preset.rs`, `encoder.rs`, `queue.rs`
- `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- `package.json` (vitest, `test` script)

## Working notes

- Another Claude session is editing this repository at the same time (preset import). Implementation happens in a git worktree on a feature branch to keep the two changesets apart.
- `probe.rs` already exposes `width` and `height`; the comment there anticipating "square-crop image presets" becomes outdated once `probe_media_size` consumes them and should be updated.
