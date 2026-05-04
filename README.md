# wgr-clip

Drag-drop video transcoder for the web. Built for clients who shouldn't have
to know what H.264 means.

## Stack
- Tauri 2 + Rust
- Nuxt 4 + Nuxt UI 4 (SPA)
- ffmpeg / ffprobe sidecars (bundled, no system install required)
- macOS (universal) + Windows (x86_64)

## Quick start

```sh
npm install
node scripts/rename-sidecars.mjs   # downloads ffmpeg + ffprobe (~80 MB each)
npm run tauri:dev
```

## Project layout

```
app/                  Nuxt 4 source (UI)
src-tauri/            Rust + Tauri config
  src/transcode/      job types, ffprobe, ffmpeg encoder, queue, presets
  src/commands.rs     Tauri commands exposed to JS
  src/hw_accel.rs     boot-time encoder detection
  src/lib.rs          Tauri builder + plugin registration
  binaries/           ffmpeg-<triple> sidecars (gitignored)
  capabilities/       Tauri 2 permissions (sidecar exec scoped)
scripts/
  rename-sidecars.mjs cross-platform ffmpeg fetcher (idempotent, sha-verified)
.github/workflows/
  release.yml         tag-driven build + GitHub release (mac universal + win)
  tag-version.yml     auto-tag from src-tauri/Cargo.toml on push to main
```

## Releasing

1. Bump `src-tauri/Cargo.toml` version + `package.json` + `tauri.conf.json`.
2. Push to `main` → `tag-version.yml` creates `v<version>` tag.
3. `release.yml` builds for macOS + Windows, drafts a GitHub release with the
   `.dmg`, `.msi`, and `latest.json` updater manifest.
4. Manually publish the draft when ready.

## Code signing (deferred to v1.1)

This v1 ships **unsigned** binaries:
- **macOS**: clients must right-click → Open on first launch.
- **Windows**: SmartScreen will warn until a code-signing cert is added.

The Tauri auto-updater works regardless of OS-level signing because it uses
its own minisign verification (`TAURI_SIGNING_PRIVATE_KEY`).

`release.yml` has labelled placeholders showing where to slot Apple
notarization (rcodesign / notarytool) and Windows Azure Key Vault signing.

## See also
- [implementation plan](../../.claude/plans/ok-j-ai-besoin-pour-snug-torvalds.md)
