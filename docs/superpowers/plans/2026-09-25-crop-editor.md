# Crop Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second "Recadrer" drop zone that opens an inline crop editor for images and runs the cropped result through the existing image pipeline.

**Architecture:** The crop rectangle lives as fractions (0..1) of the source in a shared `CropRect` type, travels with the job through Tauri `start_jobs`, and becomes an ffmpeg `crop=` filter placed before the existing `scale=` in `image_args`. The preview is a downscaled JPEG rendered by the ffmpeg sidecar and returned as raw bytes; the editor is a pure geometry module plus a thin Vue component with pointer events. A single Tauri drag-drop listener hit-tests the cursor position against registered zones.

**Tech Stack:** Tauri 2.11 (Rust, `tauri-plugin-shell` sidecar with `set_raw_out`, `tauri::ipc::Response`), Nuxt 4 + Nuxt UI 4 (Vue 3 Composition API, native CSS), Vitest 5 for the geometry module, `cargo test` for Rust.

**Spec:** `docs/superpowers/specs/2026-09-24-crop-editor-design.md`

## Global Constraints

- Tauri 2 only (no v1 plugins). Nuxt 4 + Nuxt UI 4, Tailwind v4 via `@theme`, native CSS in components. `ssr: true` stays in `nuxt.config.ts`. Dev port is 1420.
- UI strings in French, code and comments in English. Comments only when the WHY is non-obvious. No `any`.
- No new Cargo dependency. No change to `src-tauri/capabilities/default.json` or `tauri.conf.json`.
- Images only: the crop zone refuses video and audio with a toast.
- `CropRect { x, y, w, h }` are fractions of the source image, `f32` in Rust, `number` in TS.
- Crop filter expression: `crop=trunc(iw*W/2)*2:trunc(ih*H/2)*2:trunc(iw*X):trunc(ih*Y)` with six decimals, before `scale=`, in `image_args` only.
- Output name for cropped jobs: `<stem>_crop_<preset-slug>.jpg`, existing `_2`, `_3` collision rule.
- Preview: longest side ≤ 1200 px, `-f image2pipe -c:v mjpeg -q:v 4 -pix_fmt yuvj420p`, returned as raw bytes.
- Geometry: `MIN_SIZE = 0.02` on both axes; ratio locks `1:1`, `4:5`, `3:2`, `16:9`, `9:16`; a ratio is pixel width / pixel height, so in fractions `h = w * imageAspect / ratio` with `imageAspect = sourceW / sourceH`.
- UI copy (verbatim): zone title "Recadrer", hint "Déposez une image, choisissez le cadre.", buttons "Recadrer et convertir", "Passer", "Annuler", chips "Libre" + the five ratios, status label "Recadrage", toasts "Images seulement", "Aperçu impossible".
- Commits after every task on the feature branch, English messages, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `git add -A` or `git add .`: `.claude/` (sibling worktree) and `src-tauri/icons/.migra.ttf` are untracked and must stay out. No push.

## Review Focus

1. An iPhone portrait photo with EXIF rotation: the preview, the pixel readout and the output must agree on orientation. What you see is what you crop. (Manual, Task 8.)
2. A panorama (aspect ≈ 4) with the 9:16 lock: the frame must stay inside the image and keep the ratio when dragged. (Vitest, Task 4.)
3. Dragging a handle past the opposite edge: width and height never go below `MIN_SIZE`, never negative. (Vitest, Task 4.)
4. A corrupt or unreadable image in the middle of a multi-file batch: toast, advance to the next image, editor never stuck on the spinner. (Manual, Task 8.)
5. Cropping the same photo twice with the same preset: second output gets `_2`, first is never overwritten. (cargo test, Task 2.)

## Before Task 1: isolated worktree

Another Claude session is editing this repo in `.claude/worktrees/feat-preset-import` (branch `worktree-feat-preset-import`). Create your own worktree with the `superpowers:using-git-worktrees` skill on branch `feat/crop-editor` from `master`. Inside the new worktree:

```bash
npm install                      # also runs `nuxt prepare` → .nuxt/ (needed by eslint + typecheck)
ln -s "$(git -C "$(git rev-parse --show-toplevel)" worktree list --porcelain | head -1 | cut -d' ' -f2)/src-tauri/binaries" src-tauri/binaries
cd src-tauri && cargo build && cd ..
```

`src-tauri/binaries` is gitignored, so the symlink reuses the ffmpeg/ffprobe sidecars already downloaded in the main checkout instead of fetching 160 MB again. Before any `npm run tauri:dev`, run `lsof -i :1420`; if the other session's dev server holds the port, stop it first (both worktrees share `devUrl`).

---

### Task 1: `CropRect` type and crop filter in `image_args`

**Files:**
- Modify: `src-tauri/src/transcode/mod.rs` (after the `CustomParams` struct, line 48)
- Modify: `src-tauri/src/transcode/preset.rs` (`build_args`, `image_args`, new `crop_filter`, tests)
- Modify: `src-tauri/src/transcode/encoder.rs:114` (call site, pass `None` for now)
- Modify: `src-tauri/src/commands.rs:148-156` (call site, pass `None` for now)

**Interfaces:**
- Produces: `pub struct CropRect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }` in `transcode/mod.rs`; `pub fn crop_filter(rect: CropRect) -> String`; `build_args(kind, preset, hw, input, output, input_height, custom, crop: Option<CropRect>)`.

- [ ] **Step 1: Add the type**

In `src-tauri/src/transcode/mod.rs`, right after the `CustomParams` struct:

```rust
/// Crop region as fractions of the decoded source (0..1). Fractions keep the
/// rectangle valid whatever the preview size and let ffmpeg resolve pixels
/// via `iw`/`ih`, so preview and encode always agree.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src-tauri/src/transcode/preset.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn rect() -> CropRect {
        CropRect { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }
    }

    fn vf(args: &[String]) -> Option<String> {
        args.iter().position(|a| a == "-vf").map(|i| args[i + 1].clone())
    }

    #[test]
    fn crop_filter_formats_fractions_with_even_size() {
        assert_eq!(
            crop_filter(rect()),
            "crop=trunc(iw*0.500000/2)*2:trunc(ih*0.800000/2)*2:trunc(iw*0.250000):trunc(ih*0.100000)"
        );
    }

    #[test]
    fn image_args_crop_precedes_scale() {
        let a = image_args(Preset::Web1080p, Path::new("in.jpg"), Path::new("out.jpg"), None, Some(rect()));
        let f = vf(&a).expect("-vf present");
        assert!(f.starts_with("crop="), "{f}");
        assert!(f.contains(",scale="), "{f}");
    }

    #[test]
    fn image_args_crop_alone_when_preset_has_no_max_dim() {
        let a = image_args(Preset::Source, Path::new("in.jpg"), Path::new("out.jpg"), None, Some(rect()));
        let f = vf(&a).expect("-vf present");
        assert!(f.starts_with("crop="), "{f}");
        assert!(!f.contains("scale="), "{f}");
    }

    #[test]
    fn image_args_without_crop_keep_current_behaviour() {
        let source = image_args(Preset::Source, Path::new("in.jpg"), Path::new("out.jpg"), None, None);
        assert!(vf(&source).is_none());
        let web = image_args(Preset::Web1080p, Path::new("in.jpg"), Path::new("out.jpg"), None, None);
        assert!(vf(&web).unwrap().starts_with("scale="));
    }
}
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd src-tauri && cargo test preset::tests 2>&1 | tail -20`
Expected: compile error, `cannot find function crop_filter` and `image_args` takes 4 arguments but 5 were supplied.

- [ ] **Step 4: Implement**

In `src-tauri/src/transcode/preset.rs`:

```rust
use super::{CropRect, CustomParams, MediaKind, Preset};
```

Change `build_args`:

```rust
pub fn build_args(
    kind: MediaKind,
    preset: Preset,
    hw: HwAccel,
    input: &Path,
    output: &Path,
    input_height: u32,
    custom: Option<CustomParams>,
    crop: Option<CropRect>,
) -> Vec<String> {
    match kind {
        MediaKind::Video => video_args(preset, hw, input, output, input_height, custom),
        MediaKind::Image => image_args(preset, input, output, custom, crop),
        MediaKind::Audio => audio_args(preset, input, output, custom),
    }
}
```

Add `crop_filter` just above `image_args`:

```rust
/// ffmpeg crop expression from a fractional rect. Width/height are forced
/// even because the JPEG output is yuvj420p.
pub fn crop_filter(rect: CropRect) -> String {
    format!(
        "crop=trunc(iw*{w:.6}/2)*2:trunc(ih*{h:.6}/2)*2:trunc(iw*{x:.6}):trunc(ih*{y:.6})",
        w = rect.w,
        h = rect.h,
        x = rect.x,
        y = rect.y
    )
}
```

Change `image_args` signature and its `-vf` block:

```rust
fn image_args(
    preset: Preset,
    input: &Path,
    output: &Path,
    custom: Option<CustomParams>,
    crop: Option<CropRect>,
) -> Vec<String> {
```

Replace the existing `if max_dim > 0 { a.push("-vf") ... }` block with:

```rust
    let mut filters: Vec<String> = Vec::new();
    if let Some(rect) = crop {
        filters.push(crop_filter(rect));
    }
    if max_dim > 0 {
        // Fit within a max_dim square preserving aspect; only downscale (no upscale).
        filters.push(format!(
            "scale='if(gte(iw,ih),min({m},iw),-2)':'if(gte(iw,ih),-2,min({m},ih))'",
            m = max_dim
        ));
    }
    if !filters.is_empty() {
        a.push("-vf".into());
        a.push(filters.join(","));
    }
```

Update the two call sites so the crate compiles (Task 2 replaces these `None`s):

`src-tauri/src/transcode/encoder.rs:114`:
```rust
    let args = build_args(kind, preset, hw, input, output, probed.height, custom, None);
```

`src-tauri/src/commands.rs:148-156`, add `None,` as the last argument of the `build_args(` call inside `get_diagnostics`.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test preset::tests 2>&1 | tail -20`
Expected: `test result: ok. 4 passed`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/transcode/mod.rs src-tauri/src/transcode/preset.rs src-tauri/src/transcode/encoder.rs src-tauri/src/commands.rs
git commit -m "feat(crop): add CropRect and crop filter to image args

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Carry `crop` through the job model, queue, encoder and commands; cropped output naming

**Files:**
- Modify: `src-tauri/src/transcode/mod.rs` (`Job` struct + `Job::new`)
- Modify: `src-tauri/src/transcode/queue.rs` (`enqueue`, dispatcher snapshot, `run_job` call)
- Modify: `src-tauri/src/transcode/encoder.rs` (`run_job`, `try_encode`, `resolve_output_path`, tests)
- Modify: `src-tauri/src/commands.rs` (`StartJobsArgs`, `start_jobs`, `retry_job`, `get_diagnostics`)

**Interfaces:**
- Consumes: `CropRect`, `build_args(..., crop)` from Task 1.
- Produces: `Job.crop: Option<CropRect>`; `JobQueue::enqueue(input, output, preset, kind, custom, crop)`; `encoder::run_job(app, job_id, input, output, preset, kind, custom, crop, hw, cancel)`; `resolve_output_path(input, output_dir, preset, kind, cropped: bool)`; `StartJobsArgs.crop: Option<CropRect>` (serde default) — the JS side sends `crop` in the `start_jobs` args object.

- [ ] **Step 1: Write the failing naming test**

Append to `src-tauri/src/transcode/encoder.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wgr-clip-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cropped_output_gets_crop_infix() {
        let dir = temp_dir();
        let cropped = resolve_output_path(Path::new("/pics/photo.HEIC"), &dir, Preset::Web1080p, MediaKind::Image, true);
        assert_eq!(cropped.file_name().unwrap().to_str().unwrap(), "photo_crop_web.jpg");
        let plain = resolve_output_path(Path::new("/pics/photo.HEIC"), &dir, Preset::Web1080p, MediaKind::Image, false);
        assert_eq!(plain.file_name().unwrap().to_str().unwrap(), "photo_web.jpg");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cropped_output_never_overwrites_an_existing_file() {
        let dir = temp_dir();
        std::fs::write(dir.join("photo_crop_web.jpg"), b"x").unwrap();
        let second = resolve_output_path(Path::new("/pics/photo.jpg"), &dir, Preset::Web1080p, MediaKind::Image, true);
        assert_eq!(second.file_name().unwrap().to_str().unwrap(), "photo_crop_web_2.jpg");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test encoder::tests 2>&1 | tail -20`
Expected: compile error, `resolve_output_path` takes 4 arguments but 5 were supplied.

- [ ] **Step 3: Job model**

`src-tauri/src/transcode/mod.rs`, in `pub struct Job` add after `pub custom: Option<CustomParams>,`:

```rust
    pub crop: Option<CropRect>,
```

`Job::new` gains the parameter and field:

```rust
    pub fn new(
        input: PathBuf,
        output: PathBuf,
        preset: Preset,
        kind: MediaKind,
        custom: Option<CustomParams>,
        crop: Option<CropRect>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            input,
            output,
            preset,
            kind,
            custom,
            crop,
            status: JobStatus::Pending,
            progress: 0.0,
            speed_x: 0.0,
            eta_s: 0,
            fps: 0.0,
            duration_us: 0,
            stderr_tail: Vec::new(),
            error: None,
        }
    }
```

- [ ] **Step 4: Encoder**

`src-tauri/src/transcode/encoder.rs`:

```rust
use super::{
    preset::build_args, probe::probe, CropRect, CustomParams, JobCancelledEvent, JobDoneEvent, JobErrorEvent,
    MediaKind, Preset, ProgressTick,
};
```

`run_job`: add `crop: Option<CropRect>,` right after `custom: Option<CustomParams>,` in the signature. Both `try_encode(...)` calls inside `run_job` (the hardware attempt and the libx264 retry) pass `crop` right after `custom`:

```rust
    let attempt = try_encode(&app, job_id, input, output, preset, kind, custom, crop, hw, &cancel, &probed).await;
```
```rust
            match try_encode(&app, job_id, input, output, preset, kind, custom, crop, HwAccel::Software, &cancel, &probed).await {
```

`try_encode`: add `crop: Option<CropRect>,` after `custom: Option<CustomParams>,` and replace the Task 1 `None`:

```rust
    let args = build_args(kind, preset, hw, input, output, probed.height, custom, crop);
```

`resolve_output_path`:

```rust
pub fn resolve_output_path(
    input: &Path,
    output_dir: &Path,
    preset: Preset,
    kind: MediaKind,
    cropped: bool,
) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".into());
    let ext = kind.output_ext();
    let base = if cropped {
        format!("{stem}_crop_{}", preset.slug())
    } else {
        format!("{stem}_{}", preset.slug())
    };
    let mut candidate = output_dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = output_dir.join(format!("{base}_{n}.{ext}"));
        n += 1;
    }
    candidate
}
```

- [ ] **Step 5: Queue**

`src-tauri/src/transcode/queue.rs`:

```rust
use super::{encoder, CropRect, CustomParams, Job, JobStatus, MediaKind, Preset};
```

Dispatcher snapshot (line 42):

```rust
                let (input, output, preset, kind, custom, crop) = match jobs_w.get(&id) {
                    Some(j) => (
                        j.input.clone(),
                        j.output.clone(),
                        j.preset,
                        j.kind,
                        j.custom,
                        j.crop,
                    ),
```

`run_job` call: add `crop,` right after `custom,`.

`enqueue`:

```rust
    pub fn enqueue(
        &self,
        input: PathBuf,
        output: PathBuf,
        preset: Preset,
        kind: MediaKind,
        custom: Option<CustomParams>,
        crop: Option<CropRect>,
    ) -> Uuid {
        let job = Job::new(input, output, preset, kind, custom, crop);
```

- [ ] **Step 6: Commands**

`src-tauri/src/commands.rs`:

```rust
use crate::transcode::{encoder, CropRect, CustomParams, Job, JobDiagnostics, MediaKind, Preset};
```

`StartJobsArgs`:

```rust
#[derive(Debug, Deserialize)]
pub struct StartJobsArgs {
    pub inputs: Vec<PathBuf>,
    pub preset: Preset,
    #[serde(default)]
    pub custom: Option<CustomParams>,
    pub output_dir: Option<PathBuf>,
    /// Applies to every input of the call; the frontend sends one input per
    /// cropped job.
    #[serde(default)]
    pub crop: Option<CropRect>,
}
```

`start_jobs` body:

```rust
        let output = encoder::resolve_output_path(&input, &dir, args.preset, kind, args.crop.is_some());
        let id = state
            .queue
            .enqueue(input, output, args.preset, kind, args.custom, args.crop);
```

`retry_job`:

```rust
    let (input, output, preset, kind, custom, crop) = match state.queue.jobs.get(&id) {
        Some(j) => (
            j.input.clone(),
            j.output.clone(),
            j.preset,
            j.kind,
            j.custom,
            j.crop,
        ),
        None => return Err(AppError::Other(format!("job {id} not found"))),
    };
    state.queue.jobs.remove(&id);
    let new_id = state.queue.enqueue(input, output, preset, kind, custom, crop);
```

`get_diagnostics`: after `let custom = j.custom;` add `let crop = j.crop;` and replace the Task 1 `None,` in the `build_args(` call with `crop,`.

- [ ] **Step 7: Build and test**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: `6 passed` (4 preset + 2 encoder), no warnings about unused `crop`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/transcode/mod.rs src-tauri/src/transcode/queue.rs src-tauri/src/transcode/encoder.rs src-tauri/src/commands.rs
git commit -m "feat(crop): carry crop through jobs, queue and output naming

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `render_crop_preview` and `probe_media_size` commands

**Files:**
- Modify: `src-tauri/src/commands.rs` (new structs, `preview_args`, two commands, tests)
- Modify: `src-tauri/src/lib.rs:62-73` (`generate_handler!`)

**Interfaces:**
- Consumes: `crate::transcode::probe::probe(&AppHandle, &Path) -> Result<ProbeResult, JobError>` (existing; `ProbeResult.width/height: u32`).
- Produces: JS `invoke<ArrayBuffer>('render_crop_preview', { input })` → JPEG bytes; JS `invoke<{ width: number, height: number }>('probe_media_size', { input })`.

- [ ] **Step 1: Write the failing test**

Append to the end of `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_args_render_one_downscaled_jpeg_to_stdout() {
        let a = preview_args(Path::new("/pics/in.heic"));
        assert_eq!(a.last().unwrap(), "pipe:1");
        assert!(a.windows(2).any(|w| w[0] == "-frames:v" && w[1] == "1"));
        assert!(a.windows(2).any(|w| w[0] == "-f" && w[1] == "image2pipe"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "mjpeg"));
        let vf = a.iter().position(|x| x == "-vf").map(|i| a[i + 1].clone()).unwrap();
        assert!(vf.contains("min(1200,iw)") && vf.contains("min(1200,ih)"), "{vf}");
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test commands::tests 2>&1 | tail -10`
Expected: compile error, `cannot find function preview_args`.

- [ ] **Step 3: Implement the commands**

Add to `src-tauri/src/commands.rs`, after `AppInfo`:

```rust
#[derive(Debug, Serialize)]
pub struct MediaSize {
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn probe_media_size(app: AppHandle, input: PathBuf) -> Result<MediaSize, AppError> {
    let p = crate::transcode::probe::probe(&app, &input).await?;
    Ok(MediaSize { width: p.width, height: p.height })
}

/// One downscaled JPEG frame to stdout. Same decoder as the final encode, so
/// the fractional crop drawn on this preview maps 1:1 onto the output.
pub fn preview_args(input: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input.display().to_string(),
        "-vf".into(),
        "scale='if(gte(iw,ih),min(1200,iw),-2)':'if(gte(iw,ih),-2,min(1200,ih))'".into(),
        "-frames:v".into(),
        "1".into(),
        "-f".into(),
        "image2pipe".into(),
        "-c:v".into(),
        "mjpeg".into(),
        "-q:v".into(),
        "4".into(),
        "-pix_fmt".into(),
        "yuvj420p".into(),
        "pipe:1".into(),
    ]
}

#[tauri::command]
pub async fn render_crop_preview(app: AppHandle, input: PathBuf) -> Result<tauri::ipc::Response, AppError> {
    use tauri_plugin_shell::{process::CommandEvent, ShellExt};

    // set_raw_out: the default reader splits on newlines and would corrupt JPEG bytes.
    let cmd = app
        .shell()
        .sidecar("ffmpeg")?
        .args(preview_args(&input))
        .set_raw_out(true);
    let (mut rx, _child) = cmd.spawn()?;

    let mut bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code: i32 = -1;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(buf) => bytes.extend_from_slice(&buf),
            CommandEvent::Stderr(buf) => stderr.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Terminated(p) => {
                exit_code = p.code.unwrap_or(-1);
                break;
            }
            _ => {}
        }
    }

    if exit_code != 0 || bytes.is_empty() {
        return Err(AppError::Other(format!(
            "preview failed (exit {exit_code}): {}",
            stderr.trim()
        )));
    }
    Ok(tauri::ipc::Response::new(bytes))
}
```

Register in `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]` after `commands::reveal_in_folder,`:

```rust
            commands::render_crop_preview,
            commands::probe_media_size,
```

- [ ] **Step 4: Build and test**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: `7 passed`. `cargo build` prints no warnings for `commands.rs`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(crop): add preview and size commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Vitest, shared TS types and the pure crop geometry

**Files:**
- Modify: `package.json` (`test` script, `vitest` devDependency)
- Create: `vitest.config.ts`
- Modify: `app/types/job.ts`
- Create: `app/utils/cropGeometry.ts`
- Test: `app/utils/cropGeometry.test.ts`

**Interfaces:**
- Produces (TS): `CropRect`, `MediaSize`, `Job.crop: CropRect | null` in `~/types/job`; from `~/utils/cropGeometry`: `type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`, `MIN_SIZE`, `RATIO_PRESETS: readonly { label: string, value: number }[]`, `initialRect(ratio: number | null, imageAspect: number): CropRect`, `moveRect(r, dx, dy): CropRect`, `resizeRect(r, handle, dx, dy, ratio: number | null, imageAspect): CropRect`, `applyRatio(r, ratio, imageAspect): CropRect`, `clampRect(r): CropRect`.

- [ ] **Step 1: Baseline the existing checks**

Run: `npm run lint && npm run typecheck`
Note any pre-existing errors: later tasks must not add new ones.

- [ ] **Step 2: Install Vitest and add the script**

```bash
npm install -D vitest@^5
```

In `package.json` `scripts`, after `"lint": "eslint .",`:

```json
    "test": "vitest run",
```

Create `vitest.config.ts` at the repo root:

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

- [ ] **Step 3: Types**

In `app/types/job.ts`, after the `CustomParams` interface:

```ts
/** Crop region as fractions (0..1) of the source image. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MediaSize {
  width: number
  height: number
}
```

In `interface Job`, after `custom: CustomParams | null`:

```ts
  crop: CropRect | null
```

- [ ] **Step 4: Write the failing tests**

Create `app/utils/cropGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CropRect } from '~/types/job'
import { MIN_SIZE, applyRatio, initialRect, moveRect, resizeRect } from './cropGeometry'

function pxRatio (r: CropRect, aspect: number): number {
  return (r.w * aspect) / r.h
}

function expectRect (r: CropRect, expected: CropRect) {
  expect(r.x).toBeCloseTo(expected.x, 6)
  expect(r.y).toBeCloseTo(expected.y, 6)
  expect(r.w).toBeCloseTo(expected.w, 6)
  expect(r.h).toBeCloseTo(expected.h, 6)
}

function expectInside (r: CropRect) {
  expect(r.x).toBeGreaterThanOrEqual(0)
  expect(r.y).toBeGreaterThanOrEqual(0)
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9)
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9)
  expect(r.w).toBeGreaterThanOrEqual(MIN_SIZE - 1e-9)
  expect(r.h).toBeGreaterThanOrEqual(MIN_SIZE - 1e-9)
}

describe('initialRect', () => {
  it('free: centered box covering 80%', () => {
    expectRect(initialRect(null, 1.5), { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
  })

  it('locked 1:1 on a 3:2 image: full height, centered square', () => {
    const r = initialRect(1, 1.5)
    expectRect(r, { x: 1 / 6, y: 0, w: 2 / 3, h: 1 })
    expect(pxRatio(r, 1.5)).toBeCloseTo(1, 6)
  })
})

describe('moveRect', () => {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }

  it('translates', () => {
    expectRect(moveRect(base, 0.05, -0.05), { x: 0.15, y: 0.05, w: 0.8, h: 0.8 })
  })

  it('clamps to the image edges', () => {
    expectRect(moveRect(base, 0.5, -0.5), { x: 0.2, y: 0, w: 0.8, h: 0.8 })
  })
})

describe('resizeRect free', () => {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }

  it('se grows right and bottom', () => {
    expectRect(resizeRect(base, 'se', 0.1, 0.1, null, 1), { x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
  })

  it('nw moves the left and top edges', () => {
    expectRect(resizeRect(base, 'nw', -0.05, -0.05, null, 1), { x: 0.05, y: 0.05, w: 0.55, h: 0.55 })
  })

  it('e clamps at the right edge', () => {
    expectRect(resizeRect(base, 'e', 0.9, 0, null, 1), { x: 0.1, y: 0.1, w: 0.9, h: 0.5 })
  })

  it('s clamps at the bottom edge', () => {
    expectRect(resizeRect(base, 's', 0, 0.9, null, 1), { x: 0.1, y: 0.1, w: 0.5, h: 0.9 })
  })

  it('w dragged past the right edge stops at MIN_SIZE', () => {
    expectRect(resizeRect(base, 'w', 0.6, 0, null, 1), { x: 0.6 - MIN_SIZE, y: 0.1, w: MIN_SIZE, h: 0.5 })
  })

  it('n dragged past the bottom edge stops at MIN_SIZE', () => {
    expectRect(resizeRect(base, 'n', 0, 0.9, null, 1), { x: 0.1, y: 0.6 - MIN_SIZE, w: 0.5, h: MIN_SIZE })
  })
})

describe('resizeRect locked', () => {
  it('se on a square image keeps 1:1 and follows the horizontal drag', () => {
    expectRect(resizeRect({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, 'se', 0.2, 0, 1, 1), { x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
  })

  it('se caps the derived height at the bottom edge and shrinks the width', () => {
    expectRect(resizeRect({ x: 0.1, y: 0.5, w: 0.4, h: 0.4 }, 'se', 0.5, 0, 1, 1), { x: 0.1, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('nw anchors on the bottom-right corner', () => {
    expectRect(resizeRect({ x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, 'nw', -0.2, 0, 1, 1), { x: 0.3, y: 0.3, w: 0.5, h: 0.5 })
  })

  it('e keeps the vertical center', () => {
    expectRect(resizeRect({ x: 0.2, y: 0.3, w: 0.4, h: 0.4 }, 'e', 0.2, 0, 1, 1), { x: 0.2, y: 0.2, w: 0.6, h: 0.6 })
  })

  it('n keeps the horizontal center with a 2:1 lock', () => {
    expectRect(resizeRect({ x: 0.3, y: 0.5, w: 0.4, h: 0.2 }, 'n', 0, -0.1, 2, 1), { x: 0.2, y: 0.4, w: 0.6, h: 0.3 })
  })

  it('panorama (aspect 4) with a 9:16 lock stays inside and keeps the ratio', () => {
    const aspect = 4
    const start = initialRect(9 / 16, aspect)
    expectInside(start)
    expect(pxRatio(start, aspect)).toBeCloseTo(9 / 16, 6)
    const r = resizeRect(start, 'se', 0.3, 0.3, 9 / 16, aspect)
    expectInside(r)
    expect(pxRatio(r, aspect)).toBeCloseTo(9 / 16, 6)
  })
})

describe('applyRatio', () => {
  it('keeps center and width, derives height', () => {
    expectRect(applyRatio({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 16 / 9, 1), { x: 0.1, y: 0.275, w: 0.8, h: 0.45 })
  })

  it('shrinks the width when the derived height overflows', () => {
    expectRect(applyRatio({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 9 / 16, 1), { x: 0.21875, y: 0, w: 0.5625, h: 1 })
  })
})
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./cropGeometry"`.

- [ ] **Step 6: Implement the geometry**

Create `app/utils/cropGeometry.ts`:

```ts
import type { CropRect } from '~/types/job'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_SIZE = 0.02

/** Ratios are pixel width / pixel height. */
export const RATIO_PRESETS: readonly { label: string, value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 }
]

// Fractions are not isotropic: a pixel ratio maps to fractions through the
// image's own aspect (sourceW / sourceH).
function heightForWidth (w: number, ratio: number, imageAspect: number): number {
  return (w * imageAspect) / ratio
}

function widthForHeight (h: number, ratio: number, imageAspect: number): number {
  return (h * ratio) / imageAspect
}

export function clampRect (r: CropRect): CropRect {
  const w = Math.max(MIN_SIZE, Math.min(1, r.w))
  const h = Math.max(MIN_SIZE, Math.min(1, r.h))
  const x = Math.max(0, Math.min(1 - w, r.x))
  const y = Math.max(0, Math.min(1 - h, r.y))
  return { x, y, w, h }
}

export function applyRatio (r: CropRect, ratio: number, imageAspect: number): CropRect {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let w = r.w
  let h = heightForWidth(w, ratio, imageAspect)
  if (h > 1) {
    h = 1
    w = widthForHeight(h, ratio, imageAspect)
  }
  if (h < MIN_SIZE) {
    h = MIN_SIZE
    w = widthForHeight(h, ratio, imageAspect)
  }
  if (w > 1) {
    w = 1
    h = heightForWidth(w, ratio, imageAspect)
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h })
}

export function initialRect (ratio: number | null, imageAspect: number): CropRect {
  const base: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  return ratio === null ? base : applyRatio(base, ratio, imageAspect)
}

export function moveRect (r: CropRect, dx: number, dy: number): CropRect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy })
}

interface Edges { nl: number, nr: number, nt: number, nb: number }

export function resizeRect (
  r: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  imageAspect: number
): CropRect {
  const left = r.x
  const top = r.y
  const right = r.x + r.w
  const bottom = r.y + r.h
  const e: Edges = { nl: left, nr: right, nt: top, nb: bottom }
  if (handle.includes('w')) e.nl = Math.min(Math.max(0, left + dx), right - MIN_SIZE)
  if (handle.includes('e')) e.nr = Math.max(Math.min(1, right + dx), left + MIN_SIZE)
  if (handle.includes('n')) e.nt = Math.min(Math.max(0, top + dy), bottom - MIN_SIZE)
  if (handle.includes('s')) e.nb = Math.max(Math.min(1, bottom + dy), top + MIN_SIZE)
  if (ratio === null) return { x: e.nl, y: e.nt, w: e.nr - e.nl, h: e.nb - e.nt }
  return fitRatio(e, handle, ratio, imageAspect)
}

function fitRatio (e: Edges, handle: Handle, ratio: number, imageAspect: number): CropRect {
  let { nl, nr, nt, nb } = e
  if (handle === 'n' || handle === 's') {
    // Height drives, width grows symmetrically around the horizontal center.
    const cx = (nl + nr) / 2
    let h = nb - nt
    let w = widthForHeight(h, ratio, imageAspect)
    const maxW = 2 * Math.min(cx, 1 - cx)
    if (w > maxW) {
      w = maxW
      h = heightForWidth(w, ratio, imageAspect)
    }
    if (handle === 'n') nt = nb - h
    else nb = nt + h
    nl = cx - w / 2
    nr = cx + w / 2
  } else if (handle === 'e' || handle === 'w') {
    const cy = (nt + nb) / 2
    let w = nr - nl
    let h = heightForWidth(w, ratio, imageAspect)
    const maxH = 2 * Math.min(cy, 1 - cy)
    if (h > maxH) {
      h = maxH
      w = widthForHeight(h, ratio, imageAspect)
    }
    if (handle === 'w') nl = nr - w
    else nr = nl + w
    nt = cy - h / 2
    nb = cy + h / 2
  } else {
    // Corner: width drives, the handle's own vertical edge follows, the
    // opposite corner stays put.
    let w = nr - nl
    let h = heightForWidth(w, ratio, imageAspect)
    const maxH = handle.includes('n') ? nb : 1 - nt
    if (h > maxH) {
      h = maxH
      w = widthForHeight(h, ratio, imageAspect)
    }
    if (handle.includes('w')) nl = nr - w
    else nr = nl + w
    if (handle.includes('n')) nt = nb - h
    else nb = nt + h
  }
  return clampRect({ x: nl, y: nt, w: nr - nl, h: nb - nt })
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: `Test Files 1 passed`, `Tests 18 passed`.

- [ ] **Step 8: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no new errors versus the Step 1 baseline. (`Job.crop` is now required: `makeJob` in `useTranscodeQueue.ts` will error until Task 5 — if typecheck flags it, add `crop: null` to the object literal in `makeJob` now; Task 5 replaces it.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts app/types/job.ts app/utils/cropGeometry.ts app/utils/cropGeometry.test.ts
git commit -m "feat(crop): add crop geometry with vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Queue helpers, `addCroppedInput` and the `useCropSession` composable

**Files:**
- Modify: `app/composables/useTranscodeQueue.ts`
- Create: `app/composables/useCropSession.ts`

**Interfaces:**
- Consumes: `CropRect`, `MediaSize` from `~/types/job`; `initialRect`, `applyRatio` from `~/utils/cropGeometry`; Tauri commands `expand_paths`, `render_crop_preview`, `probe_media_size`, `start_jobs` (with `crop`) from Tasks 2-3.
- Produces from `useTranscodeQueue.ts`: `export const IMAGE_EXTS`, `export function detectKind(path): MediaKind`, `export function splitIcloudStubs(paths): { stubs: string[], paths: string[] }`, `export function toastIcloudStubs(stubs: string[])`, and on the composable `addCroppedInput(input: string, crop: CropRect): Promise<void>`.
- Produces from `useCropSession()`: `current: ComputedRef<CropCurrent | null>`, `pending: ComputedRef<string[]>`, `ratio: ComputedRef<number | null>`, `loading: ComputedRef<boolean>`, `active: ComputedRef<boolean>`, `index: ComputedRef<number>`, `total: ComputedRef<number>`, `open(paths: string[]): Promise<void>`, `pickImages(): Promise<void>`, `setRect(rect)`, `setRatio(ratio: number | null)`, `confirm(): Promise<void>`, `skip(): Promise<void>`, `close()`. `CropCurrent = { input: string, previewUrl: string, rect: CropRect, sourceW: number, sourceH: number }`.

- [ ] **Step 1: Export the kind helpers and extract the iCloud filter**

In `app/composables/useTranscodeQueue.ts`:

```ts
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif']
```
(`const IMAGE_EXTS` becomes `export const IMAGE_EXTS`; leave `VIDEO_EXTS` and `AUDIO_EXTS` as they are.)

```ts
export function detectKind (path: string): MediaKind {
```

Add after `detectKind`:

```ts
// iCloud Drive placeholders: tiny stubs named `.<original>.<ext>.icloud`
// that don't contain the file content. ffmpeg can't read them.
export function splitIcloudStubs (paths: string[]): { stubs: string[], paths: string[] } {
  const isStub = (p: string) => p.toLowerCase().endsWith('.icloud')
  return { stubs: paths.filter(isStub), paths: paths.filter(p => !isStub(p)) }
}

export function toastIcloudStubs (stubs: string[]) {
  const names = stubs.map((p) => {
    const base = p.split(/[/\\]/).pop() ?? p
    // .Elouan.wav.icloud → Elouan.wav
    return base.replace(/^\./, '').replace(/\.icloud$/i, '')
  }).join(', ')
  useToast().add({
    title: 'Fichier iCloud non téléchargé',
    description: `${names} : ouvrez-le dans Finder (clic droit → Télécharger maintenant) puis réessayez.`,
    color: 'warning',
    duration: 7000
  })
}
```

Replace the iCloud block at the top of `addInputs` (from the comment `// iCloud Drive placeholders` down to `if (rawPaths.length === 0) return` inside that block) with:

```ts
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) toastIcloudStubs(split.stubs)
    rawPaths = split.paths
    if (rawPaths.length === 0) return
```

- [ ] **Step 2: Add `crop` to jobs and the cropped start**

`makeJob`:

```ts
function makeJob (id: string, input: string, output: string, preset: Preset, kind?: MediaKind, custom?: CustomParams | null, crop?: CropRect | null): Job {
  return {
    id,
    input,
    output,
    preset,
    kind: kind ?? detectKind(input),
    custom: custom ?? null,
    crop: crop ?? null,
```

Add `CropRect` to the type import list at the top of the file.

In `retry`, pass the crop through:

```ts
    if (old) m.set(newId, makeJob(newId, old.input, old.output, old.preset, old.kind, old.custom, old.crop))
```

Add after `addInputs`:

```ts
  async function addCroppedInput (input: string, crop: CropRect) {
    const preset = state.value.imagePreset
    const customForJob = preset === 'custom' ? { ...state.value.custom } : null
    let ids: string[]
    try {
      ids = await invoke<string[]>('start_jobs', {
        args: {
          inputs: [input],
          preset,
          custom: customForJob,
          output_dir: state.value.outputDir,
          crop
        }
      })
    } catch (err) {
      console.error('[queue] start_jobs (crop) failed', err)
      useToast().add({
        title: 'Échec du démarrage (image)',
        description: String(err),
        color: 'error'
      })
      return
    }
    const id = ids[0]
    if (!id) return
    const m = new Map(state.value.jobs)
    m.set(id, makeJob(id, input, '', preset, 'image', customForJob, crop))
    state.value.jobs = m
  }
```

Add `addCroppedInput,` to the returned object right after `addInputs,`.

- [ ] **Step 3: Create the session composable**

Create `app/composables/useCropSession.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { CropRect, MediaSize } from '~/types/job'
import { IMAGE_EXTS, detectKind, splitIcloudStubs, toastIcloudStubs } from '~/composables/useTranscodeQueue'
import { applyRatio, initialRect } from '~/utils/cropGeometry'
import { basename } from '~/utils/format'

export interface CropCurrent {
  input: string
  previewUrl: string
  rect: CropRect
  sourceW: number
  sourceH: number
}

interface CropState {
  pending: string[]
  current: CropCurrent | null
  ratio: number | null
  loading: boolean
  index: number
  total: number
}

export function useCropSession () {
  const state = useState<CropState>('wgr-clip-crop', () => ({
    pending: [],
    current: null,
    ratio: null,
    loading: false,
    index: 0,
    total: 0
  }))
  const queue = useTranscodeQueue()

  async function open (rawPaths: string[]) {
    const split = splitIcloudStubs(rawPaths)
    if (split.stubs.length > 0) toastIcloudStubs(split.stubs)
    if (split.paths.length === 0) return

    const expanded = await invoke<string[]>('expand_paths', { paths: split.paths })
    if (expanded.length === 0) {
      useToast().add({
        title: 'Aucun fichier supporté',
        description: `Formats acceptés : images courantes. Reçu : ${split.paths.map(basename).join(', ')}`,
        color: 'warning'
      })
      return
    }
    const images = expanded.filter(p => detectKind(p) === 'image')
    const rejected = expanded.filter(p => detectKind(p) !== 'image')
    if (rejected.length > 0) {
      useToast().add({
        title: 'Images seulement',
        description: `Le recadrage ne prend que des images. Ignoré : ${rejected.map(basename).join(', ')}`,
        color: 'warning'
      })
    }
    if (images.length === 0) return

    state.value.pending = [...state.value.pending, ...images]
    state.value.total += images.length
    if (!state.value.current && !state.value.loading) await loadNext()
  }

  async function pickImages () {
    const result = await openDialog({
      multiple: true,
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTS] }]
    })
    if (Array.isArray(result) && result.length > 0) await open(result)
    else if (typeof result === 'string') await open([result])
  }

  async function loadNext () {
    const input = state.value.pending[0]
    if (!input) {
      reset()
      return
    }
    state.value.pending = state.value.pending.slice(1)
    state.value.index += 1
    state.value.loading = true
    try {
      const [buf, size] = await Promise.all([
        invoke<ArrayBuffer>('render_crop_preview', { input }),
        invoke<MediaSize>('probe_media_size', { input })
      ])
      const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }))
      const aspect = size.width / size.height
      state.value.current = {
        input,
        previewUrl,
        rect: initialRect(state.value.ratio, aspect),
        sourceW: size.width,
        sourceH: size.height
      }
      state.value.loading = false
    } catch (e) {
      console.error('[crop] preview failed', input, e)
      useToast().add({
        title: 'Aperçu impossible',
        description: `${basename(input)} : ${String(e).split('\n')[0]}`,
        color: 'error'
      })
      state.value.loading = false
      await loadNext()
    }
  }

  function releaseCurrent () {
    const c = state.value.current
    if (c) URL.revokeObjectURL(c.previewUrl)
    state.value.current = null
  }

  function reset () {
    releaseCurrent()
    state.value.pending = []
    state.value.index = 0
    state.value.total = 0
    state.value.loading = false
  }

  function setRect (rect: CropRect) {
    const c = state.value.current
    if (c) state.value.current = { ...c, rect }
  }

  function setRatio (ratio: number | null) {
    state.value.ratio = ratio
    const c = state.value.current
    if (c && ratio !== null) {
      state.value.current = { ...c, rect: applyRatio(c.rect, ratio, c.sourceW / c.sourceH) }
    }
  }

  async function confirm () {
    const c = state.value.current
    if (!c) return
    await queue.addCroppedInput(c.input, c.rect)
    releaseCurrent()
    await loadNext()
  }

  async function skip () {
    releaseCurrent()
    await loadNext()
  }

  function close () {
    reset()
  }

  return {
    current: computed(() => state.value.current),
    pending: computed(() => state.value.pending),
    ratio: computed(() => state.value.ratio),
    loading: computed(() => state.value.loading),
    active: computed(() => state.value.current !== null || state.value.loading),
    index: computed(() => state.value.index),
    total: computed(() => state.value.total),
    open,
    pickImages,
    setRect,
    setRatio,
    confirm,
    skip,
    close
  }
}
```

- [ ] **Step 4: Lint, typecheck, unit tests**

Run: `npm run lint && npm run typecheck && npm test`
Expected: no new errors versus the Task 4 baseline; 18 tests pass. If typecheck complains that `invoke<ArrayBuffer>` cannot be narrowed, keep the generic: Tauri 2 resolves raw `ipc::Response` bodies to `ArrayBuffer`.

- [ ] **Step 5: Commit**

```bash
git add app/composables/useTranscodeQueue.ts app/composables/useCropSession.ts
git commit -m "feat(crop): add crop session composable and cropped job start

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Drop dispatch by position, presentational `DropZone`, two zones

**Files:**
- Create: `app/composables/useDropTargets.ts`
- Modify: `app/components/DropZone.vue` (full rewrite)
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `useCropSession().open / pickImages` (Task 5), `useTranscodeQueue().addInputs / pickInputFiles`.
- Produces: `useDropTargets()` → `{ hoveredId: Ref<string | null>, register(target: { id: string, el: Ref<HTMLElement | null>, onDrop: (paths: string[]) => void }): () => void }`, `CONVERT_ZONE_ID = 'convert'`, `CROP_ZONE_ID = 'crop'`. `DropZone` props `{ id: string, title: string, hint: string, icon: string }`, emits `drop(paths: string[])` and `click`.

- [ ] **Step 1: Create the dispatcher**

Create `app/composables/useDropTargets.ts`:

```ts
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'

export const CONVERT_ZONE_ID = 'convert'
export const CROP_ZONE_ID = 'crop'

export interface DropTarget {
  id: string
  el: Ref<HTMLElement | null>
  onDrop: (paths: string[]) => void
}

// One webview-wide Tauri listener shared by every zone; module scope so
// registering a second zone never attaches a second listener.
const targets = new Map<string, DropTarget>()
let unlisten: UnlistenFn | null = null

export function useDropTargets () {
  const hoveredId = useState<string | null>('wgr-clip-drop-hover', () => null)

  function hitTest (position: { x: number, y: number }): string | null {
    // Tauri reports physical pixels; DOM rects are logical.
    const dpr = window.devicePixelRatio || 1
    const px = position.x / dpr
    const py = position.y / dpr
    for (const t of targets.values()) {
      const r = t.el.value?.getBoundingClientRect()
      if (r && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return t.id
    }
    return null
  }

  function fallbackId (): string | null {
    return targets.has(CONVERT_ZONE_ID) ? CONVERT_ZONE_ID : null
  }

  async function ensureListening () {
    if (unlisten) return
    try {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload
        if (p.type === 'enter' || p.type === 'over') {
          hoveredId.value = hitTest(p.position) ?? fallbackId()
        } else if (p.type === 'leave') {
          hoveredId.value = null
        } else if (p.type === 'drop') {
          const id = hitTest(p.position) ?? fallbackId()
          hoveredId.value = null
          if (p.paths.length === 0) {
            useToast().add({
              title: 'Drop vide',
              description: 'Aucun chemin de fichier reçu. Essayez un autre dossier.',
              color: 'warning'
            })
            return
          }
          if (id) targets.get(id)?.onDrop(p.paths)
        }
      })
    } catch (e) {
      console.error('[drop] failed to attach listener', e)
      useToast().add({
        title: 'Drag-drop indisponible',
        description: 'Le listener Tauri n\'a pas pu être attaché. Essayez de relancer l\'app.',
        color: 'error'
      })
    }
  }

  function register (target: DropTarget): () => void {
    targets.set(target.id, target)
    void ensureListening()
    return () => {
      targets.delete(target.id)
      if (targets.size === 0 && unlisten) {
        unlisten()
        unlisten = null
      }
    }
  }

  return { hoveredId, register }
}
```

- [ ] **Step 2: Rewrite `DropZone.vue`**

Replace the whole file `app/components/DropZone.vue` with:

```vue
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
```

- [ ] **Step 3: Mount two zones in `index.vue`**

Replace `app/pages/index.vue` with:

```vue
<script setup lang="ts">
import { CONVERT_ZONE_ID, CROP_ZONE_ID } from '~/composables/useDropTargets'

useHead({ title: 'wgr-clip' })

const queue = useTranscodeQueue()
const crop = useCropSession()

function reportError (e: unknown) {
  console.error('[index] drop failed', e)
  useToast().add({ title: 'Erreur', description: String(e), color: 'error' })
}

function onConvertDrop (paths: string[]) {
  queue.addInputs(paths).catch(reportError)
}

function onCropDrop (paths: string[]) {
  crop.open(paths).catch(reportError)
}
</script>

<template>
  <div class="page">
    <UpdateBanner />

    <!-- Title + settings pills share the top row. clip on the left, controls
         flowing right; settings wrap to a second line on narrow windows. -->
    <section class="page__topbar">
      <h1 class="page__title">
        clip
      </h1>
      <PresetSelector kind="video" />
      <PresetSelector kind="image" />
      <PresetSelector kind="audio" />
      <DestinationPicker />
    </section>

    <CustomParamsPanel />

    <div class="page__zones">
      <DropZone
        :id="CONVERT_ZONE_ID"
        title="Déposez ou cliquez pour parcourir"
        hint="Vidéos, images, audio. Compression web en un drag."
        icon="i-lucide-arrow-down-to-line"
        @drop="onConvertDrop"
        @click="queue.pickInputFiles()"
      />
      <DropZone
        :id="CROP_ZONE_ID"
        title="Recadrer"
        hint="Déposez une image, choisissez le cadre."
        icon="i-lucide-crop"
        @drop="onCropDrop"
        @click="crop.pickImages()"
      />
    </div>

    <JobList />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

.page__topbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.page__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.65rem;
  letter-spacing: -0.02em;
  line-height: 1;
  color: #FDF7F1;
  margin: 0 auto 0 0; /* push following pills to the right edge */
}

.page__zones {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
</style>
```

- [ ] **Step 4: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Verify in the app**

Run: `lsof -i :1420` (must be empty), then `npm run tauri:dev`. Open devtools (the capability allows it) and check:
- Two zones side by side under the settings row.
- Drag a file over the window: the convert zone lights up outside both zones, the crop zone lights up only over itself.
- Drop a `.jpg` on the crop zone: a `[crop]`-free console (no error) and no job started; the session holds it (nothing visible yet, the editor comes in Task 7). Drop a `.mov` on the crop zone: toast "Images seulement".
- Drop a `.mov` on the convert zone or outside both zones: a video job starts as before.
- Click each zone: the file dialog opens; the crop one only lists image extensions.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/composables/useDropTargets.ts app/components/DropZone.vue app/pages/index.vue
git commit -m "feat(crop): route drops to zones, add Recadrer zone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Inline `CropEditor` and the "Recadrage" status label

**Files:**
- Create: `app/components/CropEditor.vue`
- Modify: `app/pages/index.vue` (swap zones ↔ editor)
- Modify: `app/components/JobRow.vue:12`

**Interfaces:**
- Consumes: `useCropSession()` (Task 5), `useDropTargets()` + `CROP_ZONE_ID` (Task 6), `moveRect`, `resizeRect`, `RATIO_PRESETS`, `Handle` (Task 4), `basename` from `~/utils/format`.

- [ ] **Step 1: Create the editor**

Create `app/components/CropEditor.vue`:

```vue
<script setup lang="ts">
import { CROP_ZONE_ID } from '~/composables/useDropTargets'
import { RATIO_PRESETS, moveRect, resizeRect, type Handle } from '~/utils/cropGeometry'
import { basename } from '~/utils/format'

const crop = useCropSession()
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

const sizeText = computed(() => {
  const c = current.value
  if (!c) return ''
  return `${Math.round(c.rect.w * c.sourceW)} × ${Math.round(c.rect.h * c.sourceH)} px`
})

const counterText = computed(() => `${crop.index.value}/${crop.total.value}`)

let drag: { kind: 'move' | Handle, lastX: number, lastY: number } | null = null

function onPointerDown (e: PointerEvent, kind: 'move' | Handle) {
  e.preventDefault()
  e.stopPropagation()
  drag = { kind, lastX: e.clientX, lastY: e.clientY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove (e: PointerEvent) {
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

function onPointerUp () {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
}

function onKey (e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    void crop.confirm()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    crop.close()
  }
}

let unregister: (() => void) | null = null

onMounted(() => {
  window.addEventListener('keydown', onKey)
  // Images dropped on the editor join the current session.
  unregister = register({ id: CROP_ZONE_ID, el: root, onDrop: paths => void crop.open(paths) })
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
      <span class="crop__size">{{ sizeText }}</span>
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
        Recadrer et convertir
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

.crop__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
```

- [ ] **Step 2: Swap zones and editor in `index.vue`**

In `app/pages/index.vue`, wrap the zones:

```vue
    <CropEditor v-if="crop.active.value" />
    <div
      v-else
      class="page__zones"
    >
      <DropZone
        ...
      />
      <DropZone
        ...
      />
    </div>
```
(keep both `DropZone` blocks exactly as written in Task 6.)

- [ ] **Step 3: Status label**

`app/components/JobRow.vue:12`:

```ts
    case 'encoding': return props.job.kind === 'image' ? (props.job.crop ? 'Recadrage' : 'Compression') : 'Conversion'
```

- [ ] **Step 4: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Verify the full pipeline in the app**

Run: `lsof -i :1420` (empty), then `npm run tauri:dev`.
- Drop one `.jpg` on "Recadrer": the zones disappear, a spinner shows briefly, the preview appears with the 80 % frame, header shows the file name and `1/1`.
- Drag the frame: it moves and stops at the edges. Drag each handle: free resize, never inverts. Pick `1:1`: the frame refits and stays square while dragging any handle (check the readout stays square in px). Pick `Libre`: free again.
- "Recadrer et convertir": the editor closes, a job appears with label "Recadrage", output `<stem>_crop_<slug>.jpg` lands next to the source and shows the chosen region at the preset's size.
- Drop three images: header `1/3`, "Passer" visible; skip one, confirm two → two jobs; after the last one the zones come back.
- While the editor is open, drop another image onto it: `total` grows and it is queued after the current one.
- Escape closes the session and drops the remaining images; Enter confirms.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/components/CropEditor.vue app/pages/index.vue app/components/JobRow.vue
git commit -m "feat(crop): inline crop editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs, stale comment, final QA

**Files:**
- Modify: `README.md` (feature list + `Project layout`)
- Modify: `CLAUDE.md` (`Where things live`, `Critical gotchas`, `Common tasks`)
- Modify: `src-tauri/src/transcode/probe.rs:7-10`

- [ ] **Step 1: README**

In `README.md`, after the "3 presets per kind" paragraph, add:

```markdown
**Recadrer** : a second drop zone opens an inline crop editor for images (free frame or 1:1 · 4:5 · 3:2 · 16:9 · 9:16 locks). The crop runs before the preset's resize; output is `<name>_crop_<preset>.jpg`.
```

In the `Project layout` block, add under `components/`:

```
    CropEditor.vue         inline crop editor (preview + draggable frame + ratio locks)
```

under `composables/`:

```
    useDropTargets.ts      single Tauri drag-drop listener, hit-tests zones by cursor position
    useCropSession.ts      queue of images to crop, preview loading, confirm/skip/close
```

under `utils/` (add the folder line if missing):

```
  utils/
    cropGeometry.ts        pure crop-rect math in fractions (move, resize, ratio lock) — vitest
```

and under `src/` → `commands.rs`: append ` render_crop_preview, probe_media_size` to its description.

- [ ] **Step 2: CLAUDE.md**

`Where things live`: add `- **Tests** → \`npm test\` (Vitest, \`app/**/*.test.ts\`) and \`cargo test\` in \`src-tauri\`.`

`Critical gotchas`, add:

```markdown
- **Binary stdout from the ffmpeg sidecar needs `set_raw_out(true)`** — the shell plugin's default reader splits on newlines and corrupts JPEG bytes. `render_crop_preview` returns them via `tauri::ipc::Response` (raw `ArrayBuffer` in JS, no base64).
- **Crop rects are fractions (0..1), never pixels.** Preview and encode share the same ffmpeg decoder, so fractions stay valid regardless of EXIF orientation or preview size. The filter is `crop=…` placed before `scale=` in `preset.rs::image_args`.
- **Drag-drop hit-testing**: Tauri's `position` is in physical pixels; divide by `devicePixelRatio` before comparing with `getBoundingClientRect()` (`useDropTargets.ts`).
```

`Common tasks`, add: `- **Change the crop editor's ratio presets**: \`RATIO_PRESETS\` in \`app/utils/cropGeometry.ts\`.`

- [ ] **Step 3: Update the stale comment in `probe.rs`**

Replace lines 7-10 of `src-tauri/src/transcode/probe.rs` with:

```rust
/// Subset of ffprobe's JSON output that the encoder actually uses. `width`
/// and `height` feed `probe_media_size` (crop editor readout); `has_audio` is
/// kept for diagnostics only.
```

- [ ] **Step 4: Full check**

Run:
```bash
npm run lint && npm run typecheck && npm test && (cd src-tauri && cargo test) && npm run generate
```
Expected: lint and typecheck clean versus the Task 4 baseline, 18 Vitest tests and 7 Rust tests pass, `nuxt generate` produces `.output/public/index.html`.

- [ ] **Step 5: Review Focus QA in the app**

Run `lsof -i :1420` (empty), then `npm run tauri:dev`:
1. Portrait iPhone photo (EXIF-rotated): the preview shows it the way ffmpeg decodes it; crop a recognisable corner; open the output: the same corner, same orientation as the preview. The readout uses ffprobe's stored dimensions.
2. A text file renamed `broken.jpg` dropped together with two real images: toast "Aperçu impossible" for `broken.jpg`, the editor moves on to the next image, never stuck on the spinner, counter still reaches `3/3`.
3. Crop the same photo twice with the same preset: the second output is `<stem>_crop_<slug>_2.jpg`.
4. Trigger an error on a cropped job (make the output folder read-only via `DestinationPicker`), "Copier le diagnostic": the argv contains `crop=`. Retry after restoring permissions: the retried job still shows "Recadrage" and produces the cropped file.
5. HEIC and AVIF sources: preview renders and the output matches the frame.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md src-tauri/src/transcode/probe.rs
git commit -m "docs: document crop editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria

- Every task committed on `feat/crop-editor`; `master` untouched by this work.
- `npm run lint`, `npm run typecheck`, `npm test`, `cargo test` and `npm run generate` pass.
- The Task 8 QA list is checked in the running app.
- Hand-off: `superpowers:finishing-a-development-branch` (merge into `master` or open a PR; the user decides, no push without confirmation).
