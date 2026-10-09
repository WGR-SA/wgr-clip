# wgr-clip — Claude project guide

Context for future agent sessions on this codebase. Read README.md first for product-level orientation.

## What this app does

Tauri 2 desktop app that turns dropped media into web-friendly files: H.264 MP4 / JPEG / MP3. A drop **stages** files rather than encoding them — they wait in a list grouped by detected kind, each group carrying its own preset, images optionally cropped — and one button starts the batch. Three presets per kind plus a "Personnalisé" mode (fit-in-box width×height, CRF, JPEG quality, audio kbps) and any preset imported from JSON. Hardware-accelerated when available (h264_videotoolbox on mac, h264_nvenc / h264_qsv on win, libx264 fallback).

## Repo conventions

- **Comments are sparse**. Add one only when the WHY is non-obvious (a hidden constraint, a workaround for a specific bug, a subtle invariant). Most identifiers are self-documenting.
- **No defensive code at internal boundaries**. Trust the Rust ↔ JS contract; only validate at user-input boundaries.
- **French throughout the UI** (target audience is Swiss French-speaking clients of WGR SA).
- **English in code** (types, comments, log messages).

## Stack constraints

- **Tauri 2** — NOT v1. Watch for stale docs that reference Tauri v1 plugins.
- **Nuxt 4 + Nuxt UI 4** — Tailwind v4 via `@theme` CSS, no `tailwind.config.ts`. Reka UI components (slot APIs may differ subtly from older Headless-UI versions).
- **`ssr: true` is mandatory in dev mode**. Setting `ssr: false` triggers Nuxt 4.4's vite-node IPC bug (`NUXT_VITE_NODE_OPTIONS.socketPath is not defined`). Production output is still a static SPA via `nuxt generate` prerendering every route.
- **Dev port = 1420** (not 3000 — collides with another WGR project's dev server). Set in both `package.json` (`nuxt dev --port 1420`) and `src-tauri/tauri.conf.json` (`devUrl`).
- **`app.baseURL: './'`** required in `nuxt.config.ts` for Tauri's `tauri://` asset resolution in production.

## Where things live

- **Frontend** → `app/`. Components in `app/components/`, composables in `app/composables/`, types in `app/types/`, pure helpers in `app/utils/` (Nuxt auto-imports them; keep them free of Tauri/Nuxt imports so vitest can run them).
- **Staging** → pure core in `app/utils/staging.ts` (dedupe by input path, crop attachment, kind grouping), thin wrapper in `app/composables/useStaging.ts`. Job creation from staged items is `app/utils/jobStart.ts`, wired by `useTranscodeQueue.startStaged`.
- **Media kind** → `detectKind`, the extension lists and `KIND_ICON` live in `app/utils/mediaKind.ts`. Three modules need them, so they are not in the queue composable.
- **User presets** → schema + conversion in `app/utils/userPresets.ts`, import/persistence in `app/composables/useUserPresets.ts`, reference file `presets/example.json`. They ride the `Preset::Custom` path: `toCustomParams()` fills a `CustomParams`, the preset `id` goes to `start_jobs` as `slug` for the output suffix.
- **Backend** → `src-tauri/src/`. Modules: `transcode/{mod,probe,encoder,preset,queue}.rs`, `commands.rs`, `errors.rs`, `hw_accel.rs`, `lib.rs`.
- **Sidecars** → `src-tauri/binaries/ffmpeg-<triple>` (gitignored). Fetched by `scripts/rename-sidecars.mjs` from evermeet.cx (mac) and BtbN (win).
- **Capabilities** → `src-tauri/capabilities/default.json`. Adding a new Tauri plugin requires adding its `<plugin>:default` permission here AND registering it in `lib.rs`.
- **Plan files** → user keeps implementation plans in `~/.claude/plans/`. The original plan is at `~/.claude/plans/ok-j-ai-besoin-pour-snug-torvalds.md`. Specs and plans for later features live in `docs/superpowers/{specs,plans}/`.
- **Tests** → `npm test` (Vitest, `app/**/*.test.ts`, pure utils only — `staging`, `jobStart`, `mediaKind`, `cropSession`, `cropGeometry`, `dropDispatcher`, `dropHitTest`, `editorKeys`, `icloud`, `userPresets`). There is **no component test harness**, which is why every piece of logic lives in a `app/utils/*` core rather than in a component and `#[cfg(test)]` modules in `preset.rs`, `mod.rs`, `encoder.rs` (`cd src-tauri && cargo test`).

## Brand assets

- Fonts: Migra-Extrabold (display) + GT-Maru-{Regular,Medium,Bold} (body) in `app/public/fonts/`. Migra has woff2 only — `wawoff2` is used in `scripts/generate-icon.mjs` to render via `@napi-rs/canvas`.
- Logo: `app/public/img/logo.svg` (white "wgr" wordmark, 287×120 viewBox).
- Palette: bg `#232323`, text `#FDF7F1`, accent `--color-icterine-400 #E1FD5F`. Defined in `app/assets/css/main.css` via Tailwind v4 `@theme`.

## Critical gotchas

- **VideoToolbox rejects `-q:v`** ("qscale not available for encoder"). Use `-b:v <kbps> -maxrate -bufsize -allow_sw 1` instead. `crf_to_kbps()` in `preset.rs` maps user CRF intent to bitrate when hardware encoder is active.
- **Universal macOS build** ships per-arch sidecars (`ffmpeg-aarch64-apple-darwin` AND `ffmpeg-x86_64-apple-darwin`). Tauri 2 picks by target triple — no lipo merge needed.
- **`.icloud` files** are tiny placeholders for non-downloaded iCloud Drive content. Detected client-side by `splitIcloudStubs` (`utils/icloud.ts`), called from `utils/staging.ts` and `utils/cropSession.ts`, to show a clear toast pointing to Finder's "Download Now".
- **Cancel race on Windows**: after `child.kill()`, sleep 100ms before `remove_file` to dodge file-lock errors. 3-retry backoff in `cleanup_partial`.
- **ffprobe duration may be 0** on some MOV/MKV streams. Falls back to `nb_frames / r_frame_rate`. If still unknown, `eta_s = 0` and the UI hides the ETA.
- **Capability JSON changes require Rust rebuild** — `tauri.conf.json` and `capabilities/*.json` are baked in at compile time via `tauri::generate_context!()`.
- **Binary stdout from the ffmpeg sidecar needs `set_raw_out(true)`** — the shell plugin's default reader splits on newlines and corrupts JPEG bytes. `render_crop_preview` returns them via `tauri::ipc::Response` (raw `ArrayBuffer` in JS, no base64).
- **Crop rects are fractions (0..1), never pixels.** Preview and encode share the same ffmpeg decoder (which autorotates), so the frame stays valid regardless of EXIF orientation or preview size. The filter is `crop=…` placed before `scale=` in `preset.rs::image_args`. **ffprobe does not autorotate**: its `width`/`height` are the stored ones, so `orientSourceSize()` swaps them to match the decoded preview before the px readout and ratio locks use them.
- **`start_jobs` takes one `crop` for the whole batch.** So `utils/jobStart.ts` issues one call per `(kind, crop)` pair — every cropped image gets a call of its own — and awaits them **sequentially**. The Rust side seeds its output-filename collision set from jobs already in flight, so serialising is what stops a second crop of the same source from overwriting the first one's file. Never `Promise.all` those calls; a test with a gate promise pins the ordering.
- **`start_jobs` returns as soon as it enqueues**; the dispatcher encodes on its own task. A batch's jobs must therefore be registered into reactive state immediately after that batch's ids come back — `patch()` silently drops an event whose job id is not yet in the Map, and `done`/`error` fire once with no retry, which would leave a card stuck at `pending` forever while the file converted correctly. This is why `startStaged` writes the Map inside `onJobs` rather than once after the loop.
- **The staging footer is frozen while a crop session is active** (`StagingPanel.vue`, `:disabled="starting || crop.active.value"`). The list stays visible during a crop on purpose, but converting mid-session would start the jobs uncropped, empty the list, and leave `setCrop` writing to items that no longer exist — losing the crop work with no error. Cancelling a session is lossless: crops already confirmed are already on their items.
- **Drag-drop hit-testing**: Tauri's `position` is in physical pixels; divide by `devicePixelRatio` before comparing with `getBoundingClientRect()` (`utils/dropHitTest.ts`). The single Tauri listener is guarded on its in-flight **promise**, not on the resolved value (`utils/dropDispatcher.ts`) — guarding the resolved value attaches the listener twice and handles every drop twice. There is only one zone on screen at a time now, but swapping `DropZone` for `CropEditor` can still register two targets in the same tick, so the guard is still load-bearing. Do not simplify it.
- **Composable logic lives in `app/utils/*` cores with injected deps** (`staging.ts`, `jobStart.ts`, `cropSession.ts`, `dropDispatcher.ts`) so Vitest covers it; the `use*` composables are thin Tauri/Nuxt wrappers.
- **Files picked with the dialog plugin are auto-added to the fs scope** (`allow_file` in tauri-plugin-dialog). That is why `readTextFile` on an imported preset file works with only `fs:allow-read-text-file` and no scope entry.
- **A longest-side cap D is the same as fitting in a D×D box.** `fit_filter()` in `preset.rs` covers both video and image scaling; the legacy `image_max_dim` setting is migrated to `image_max_width/height` in `useSettingsStore`.

## Common tasks

- **Add a Tauri plugin**: add to `Cargo.toml` deps, register in `lib.rs` builder, add `<plugin>:default` to `capabilities/default.json`, add the JS package to `package.json` if needed.
- **Change preset behavior**: edit `src-tauri/src/transcode/preset.rs::build_args` and update its tests. Frontend label changes go in `app/components/PresetSelector.vue::itemsByKind`.
- **Change the crop editor's ratio presets**: `RATIO_PRESETS` in `app/utils/cropGeometry.ts`.
- **Change what the staging list shows**: group headers and footer actions in `app/components/StagingPanel.vue`, per-file rows in `app/components/StagedRow.vue`. A staged row shows no source dimensions on purpose — staging never probes, so a 40-file drop costs no `probe_media_size` calls; only a cropped row shows a size, from the `cropPx` the editor writes at confirm time.
- **Change the preset file format**: edit the zod schema in `app/utils/userPresets.ts`, add a case to `app/utils/userPresets.test.ts`, refresh `presets/example.json` and the README table.
- **Regenerate icons**: `node scripts/generate-icon.mjs && npx tauri icon src-tauri/icons/icon-1024.png`. Use `--label X` for sibling apps.
- **Test the full pipeline locally**: `npm run tauri:dev`, drop a `.mov`, verify hw_accel detected in dev log, watch progress events fire at ~4 Hz.

## Out of scope (so far)

- Code signing (Apple Developer ID + Azure Key Vault for Windows) — labelled `# TODO v1.1` in `release.yml`.
- Sleep prevention during long encodes (caffeinate / SetThreadExecutionState).
- Parallel concurrency for image batches (currently 1 worker for all kinds; images would benefit from 4–8 parallel).
- History / recent jobs persistence beyond the current session.
- Staging is not persisted across launches; a quit with files staged loses the list, not the files.
- Re-cropping an image that already has a crop reopens with a fresh frame; the stored rect is not restored.
