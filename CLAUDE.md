# wgr-clip — Claude project guide

Context for future agent sessions on this codebase. Read README.md first for product-level orientation.

## What this app does

Tauri 2 desktop app that auto-detects dropped media kind (video / image / audio) and transcodes to web-friendly defaults: H.264 MP4 / JPEG / MP3. Three presets per kind plus a "Personnalisé" mode with custom params (max dim, CRF, JPEG quality, audio kbps). Hardware-accelerated when available (h264_videotoolbox on mac, h264_nvenc / h264_qsv on win, libx264 fallback).

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

- **Frontend** → `app/`. Components in `app/components/`, composables in `app/composables/`, types in `app/types/`.
- **Backend** → `src-tauri/src/`. Modules: `transcode/{mod,probe,encoder,preset,queue}.rs`, `commands.rs`, `errors.rs`, `hw_accel.rs`, `lib.rs`.
- **Sidecars** → `src-tauri/binaries/ffmpeg-<triple>` (gitignored). Fetched by `scripts/rename-sidecars.mjs` from evermeet.cx (mac) and BtbN (win).
- **Capabilities** → `src-tauri/capabilities/default.json`. Adding a new Tauri plugin requires adding its `<plugin>:default` permission here AND registering it in `lib.rs`.
- **Plan files** → user keeps implementation plans in `~/.claude/plans/`. The original plan is at `~/.claude/plans/ok-j-ai-besoin-pour-snug-torvalds.md`.

## Brand assets

- Fonts: Migra-Extrabold (display) + GT-Maru-{Regular,Medium,Bold} (body) in `app/public/fonts/`. Migra has woff2 only — `wawoff2` is used in `scripts/generate-icon.mjs` to render via `@napi-rs/canvas`.
- Logo: `app/public/img/logo.svg` (white "wgr" wordmark, 287×120 viewBox).
- Palette: bg `#232323`, text `#FDF7F1`, accent `--color-icterine-400 #E1FD5F`. Defined in `app/assets/css/main.css` via Tailwind v4 `@theme`.

## Critical gotchas

- **VideoToolbox rejects `-q:v`** ("qscale not available for encoder"). Use `-b:v <kbps> -maxrate -bufsize -allow_sw 1` instead. `crf_to_kbps()` in `preset.rs` maps user CRF intent to bitrate when hardware encoder is active.
- **Universal macOS build** ships per-arch sidecars (`ffmpeg-aarch64-apple-darwin` AND `ffmpeg-x86_64-apple-darwin`). Tauri 2 picks by target triple — no lipo merge needed.
- **`.icloud` files** are tiny placeholders for non-downloaded iCloud Drive content. Detected client-side in `useTranscodeQueue.addInputs` to show a clear toast pointing to Finder's "Download Now".
- **Cancel race on Windows**: after `child.kill()`, sleep 100ms before `remove_file` to dodge file-lock errors. 3-retry backoff in `cleanup_partial`.
- **ffprobe duration may be 0** on some MOV/MKV streams. Falls back to `nb_frames / r_frame_rate`. If still unknown, `eta_s = 0` and the UI hides the ETA.
- **Capability JSON changes require Rust rebuild** — `tauri.conf.json` and `capabilities/*.json` are baked in at compile time via `tauri::generate_context!()`.

## Common tasks

- **Add a Tauri plugin**: add to `Cargo.toml` deps, register in `lib.rs` builder, add `<plugin>:default` to `capabilities/default.json`, add the JS package to `package.json` if needed.
- **Change preset behavior**: edit `src-tauri/src/transcode/preset.rs::build_args`. Frontend label changes go in `app/components/PresetSelector.vue::itemsByKind`.
- **Regenerate icons**: `node scripts/generate-icon.mjs && npx tauri icon src-tauri/icons/icon-1024.png`. Use `--label X` for sibling apps.
- **Test the full pipeline locally**: `npm run tauri:dev`, drop a `.mov`, verify hw_accel detected in dev log, watch progress events fire at ~4 Hz.

## Out of scope (so far)

- Code signing (Apple Developer ID + Azure Key Vault for Windows) — labelled `# TODO v1.1` in `release.yml`.
- Sleep prevention during long encodes (caffeinate / SetThreadExecutionState).
- Parallel concurrency for image batches (currently 1 worker for all kinds; images would benefit from 4–8 parallel).
- History / recent jobs persistence beyond the current session.
