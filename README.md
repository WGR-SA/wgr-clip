<p align="center">
  <img src="src-tauri/icons/icon-1024.png" width="180" alt="wgr-clip" />
</p>

<h1 align="center">wgr-clip</h1>

Drag-drop converter for **video, image and audio** files — pour les clients qui ne devraient pas avoir à savoir ce qu'est un codec.

Drop any media → wgr-clip auto-detects the kind and produces a web-friendly file:
- **Video** → `.mp4` (H.264 + AAC, hardware-accelerated when available)
- **Image** → `.jpg` (resized to a safe max dim, JPEG quality preset)
- **Audio** → `.mp3` (LAME, universal compat)

A drop **stages** files instead of converting them straight away: they land in a "Prêt à convertir" list grouped by kind, each group carrying its own preset — Original / Web / High Quality / **Personnalisé**, plus any preset **imported from a JSON file** (see [Imported presets](#imported-presets)). One button converts the batch. Nothing is encoded until you press it, so a wrong preset costs a click rather than a re-run.

Multi-file batch with real-time progress, cancellable, error details with copy-diagnostics. Click the dropzone or drop folders — both work. A group whose encode fails to start stays in the list, ready to retry.

**Recadrer** : staged images can be cropped before conversion — from the group header for every image still uncropped, or per row for one of them. Free frame or 1:1 · 4:5 · 3:2 · 16:9 · 9:16 locks. The crop runs before the preset's resize; output is `<name>_crop_<preset>.jpg`.

Output destination and imported presets live behind the settings button.

## Stack
- **Tauri 2** + Rust transcode engine
- **Nuxt 4** + **Nuxt UI 4** (SPA)
- **ffmpeg / ffprobe** bundled as Tauri sidecars (no system install)
- **Native notifications** when batches complete
- **Persisted settings** between launches
- **Auto-updater** via GitHub Releases (`tauri-plugin-updater`)
- macOS (universal) + Windows (x86_64)

## Quick start

```sh
npm install
node scripts/rename-sidecars.mjs   # downloads ffmpeg + ffprobe (~80 MB each)
npm run tauri:dev
```

App opens at `http://localhost:1420` (port chosen to avoid collision with other Nuxt dev servers).

Tests: `npm test` (vitest, pure TS helpers in `app/**`) and `cd src-tauri && cargo test` (ffmpeg argv + output naming).

## Imported presets

Any preset menu ends with **Gérer les presets…**, which opens a manager to import a JSON file or delete imported presets. Imported presets are listed in the menu of their kind, persisted in the settings store, and their `id` becomes the output filename suffix (`photo_shop-800.jpg`). Re-importing a file with the same ids replaces those presets.

```json
{
  "presets": [
    { "id": "shop-800",  "kind": "image", "name": "Shop 800px",  "max_width": 800,  "max_height": 800, "quality": 82 },
    { "id": "hero-1080", "kind": "video", "name": "Hero 1920×1080", "max_width": 1920, "max_height": 1080, "crf": 24, "audio_kbps": 128 },
    { "id": "podcast-96", "kind": "audio", "name": "Podcast 96k", "kbps": 96 }
  ]
}
```

| Field | Kinds | Notes |
|---|---|---|
| `kind` | all | `video`, `image` or `audio` (required) |
| `name` | all | Menu label, 1–60 chars (required) |
| `id` | all | `[a-z0-9][a-z0-9_-]*`, max 40. Derived from `name` when absent (`Bannière 1920` → `banniere-1920`) |
| `max_width`, `max_height` | video, image | Fit inside the box, aspect preserved, never upscaled. `0` or absent = free |
| `crf` | video | 15–32, default 22 (mapped to a bitrate on hardware encoders) |
| `audio_kbps` | video | AAC track, 32–320, default 128 |
| `quality` | image | JPEG 1–100, default 85 |
| `kbps` | audio | MP3, 32–320, default 128 |

`presets/example.json` is a ready-to-import reference. Validation errors are shown as a toast with the offending path (`presets[0].kind : …`).

## Project layout

```
app/                       Nuxt 4 source (UI)
  components/
    DropZone.vue           drag-drop + click to pick files (compact once files are staged)
    StagingPanel.vue       "Prêt à convertir" list, per-kind preset + crop, Convert button
    StagedRow.vue          one staged file: name, crop badge, crop and remove actions
    PresetSelector.vue     pill dropdowns per media kind
    SettingsPanel.vue      slideover: output destination + imported presets
    JobList / JobRow      live progress + actions
    JobErrorPanel         expandable stderr + copy diagnostics
    CustomParamsPanel     advanced inputs when "Personnalisé" is selected, for staged kinds only
    CropEditor.vue         inline crop editor (preview + draggable frame + ratio locks)
  composables/
    useTranscodeQueue.ts   reactive Map of jobs + Tauri event listeners + startStaged
    useStaging.ts          staged files awaiting conversion, file picker
    useDropTargets.ts      single Tauri drag-drop listener, hit-tests zones by cursor position
    useCropSession.ts      queue of images to crop, preview loading, confirm/skip/close
    useUserPresets.ts      imported presets (store key `userPresets`)
    useAutoFit.ts          auto-resize Tauri window to content
    useBatchNotification   fires native notif on batch completion
    useSettingsStore       persists preferences via tauri-plugin-store
  types/job.ts             Preset, PresetSelection, MediaKind, Job, CustomParams, CropRect TS types
  utils/
    staging.ts             staging core: dedupe, crop attachment, kind grouping — vitest
    jobStart.ts            staged items → start_jobs calls, one per (kind, crop), sequential — vitest
    mediaKind.ts           extension → MediaKind, extension lists, kind icons — vitest
    cropGeometry.ts        pure crop-rect math in fractions (move, resize, ratio lock) — vitest
    cropSession.ts         crop session core (queue, preview loading, cancel-safe) with injected deps — vitest
    dropHitTest.ts         cursor position → drop zone id — vitest
    dropDispatcher.ts      zone registry + single-listener lifecycle + fallback routing — vitest
    editorKeys.ts          Enter/Escape filtering for the editor (ignores form fields, key repeat) — vitest
    icloud.ts              iCloud placeholder detection — vitest
    userPresets.ts         zod schema for preset files, CustomParams conversion — vitest
presets/example.json       reference preset file to import
src-tauri/                 Rust + Tauri config
  src/
    main.rs · lib.rs       entry, plugin registration, AppState
    hw_accel.rs            boot-time h264 encoder detection (videotoolbox / nvenc / qsv / libx264)
    commands.rs            Tauri commands invoked from JS (start_jobs, expand_paths, render_crop_preview, probe_media_size, etc.)
    transcode/
      mod.rs               Job, Preset, MediaKind, CustomParams types
      probe.rs             ffprobe duration + stream metadata
      preset.rs            (kind, preset) → ffmpeg argv mapping
      encoder.rs           spawn ffmpeg, parse `-progress pipe:1`, emit events
      queue.rs             Tokio mpsc worker, single concurrent job
    errors.rs              JobError categories surfaced to UI
  capabilities/             Tauri 2 permissions (sidecar exec scoped to ffmpeg/ffprobe)
  binaries/                 ffmpeg-<triple> sidecars (gitignored, fetched on install)
  icons/                    icns / ico / PNGs generated from icon-1024.png
scripts/
  rename-sidecars.mjs      cross-platform ffmpeg fetcher (idempotent, sanity-checks via -version)
  generate-icon.mjs        WGR-branded icon generator (--label flag, auto-fits text)
.github/workflows/
  release.yml              tag-driven build + GitHub release (mac universal + win)
  tag-version.yml          auto-tag from src-tauri/Cargo.toml on push to main
```

## Releasing

1. Bump version in `src-tauri/Cargo.toml`, `package.json`, `tauri.conf.json` (keep them in sync).
2. Push to `main` → `tag-version.yml` creates `v<version>` tag automatically.
3. `release.yml` runs the macOS + Windows matrix, drafts a GitHub release with `.dmg`, `.msi` and `latest.json` (updater manifest).
4. Manually publish the draft when QA is happy.

### Required GitHub secret
- `TAURI_SIGNING_PRIVATE_KEY` — paste the **entire content** of the file generated by `npx tauri signer generate -w ~/.tauri/wgr-clip.key`. Required even though we don't OS-codesign yet, because the auto-updater verifies a minisign signature on every payload.

## Code signing (v1.1)

v1 ships **unsigned** desktop builds:
- **macOS**: clients right-click → Open on first launch (Gatekeeper prompt). Auto-updates work transparently from then on (Tauri's minisign ≠ Apple codesign).
- **Windows**: SmartScreen will show "Unrecognized publisher" warning.

`release.yml` has labelled `# TODO v1.1` markers where Apple notarization (rcodesign / notarytool) and Windows Azure Key Vault signing slot in. The Holtmed pipeline is the reference for Azure Key Vault signing.

## Custom icons

The app icon is generated from a 1024×1024 source PNG with `npx tauri icon`:

```sh
node scripts/generate-icon.mjs                 # default label "clip"
node scripts/generate-icon.mjs --label desk    # for sibling apps
npx tauri icon src-tauri/icons/icon-1024.png   # produces icns/ico/all PNG sizes
```

## License
MIT — © wgr SA, Lausanne.
