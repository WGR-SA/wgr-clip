#!/usr/bin/env node
/**
 * Fetches ffmpeg + ffprobe sidecars for the host platform (or all macOS arches
 * with --all-targets) and places them at src-tauri/binaries/ffmpeg-<triple>[.exe]
 * matching Tauri 2's sidecar naming convention.
 *
 * Sources (LICENSE: see THIRD_PARTY_LICENSES.md):
 *   - macOS (arm64+x64): evermeet.cx universal static (LGPL, includes
 *     h264_videotoolbox; libx264 NOT included — software fallback unavailable
 *     on macOS, which is acceptable since every supported Mac has VideoToolbox).
 *   - Windows x64: BtbN/FFmpeg-Builds GPL static (libx264, libx265, nvenc, qsv).
 *
 * Usage:
 *   node scripts/rename-sidecars.mjs              # current host triple
 *   node scripts/rename-sidecars.mjs --all-targets  # every supported triple
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, chmodSync, writeFileSync, statSync, createWriteStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries')

// CI guard: skip when running inside `npm ci` postinstall on a CI runner unless explicitly opted in.
if (process.env.CI && process.env.WGR_CLIP_FETCH_FFMPEG !== '1' && process.env.npm_lifecycle_event === 'postinstall') {
  console.log('[fetch-ffmpeg] CI postinstall detected without WGR_CLIP_FETCH_FFMPEG=1 — skipping (CI runs this step explicitly).')
  process.exit(0)
}

const SOURCES = {
  // ARM64 macOS: copy from Homebrew (preinstalled on GH macos-14 runners and
  // most dev macs). evermeet.cx serves x86_64 only, so brew is the simplest
  // path to a real arm64-native binary.
  'aarch64-apple-darwin': {
    kind: 'brew',
    ext: ''
  },
  // Intel macOS: evermeet.cx ships a static x86_64 binary.
  'x86_64-apple-darwin': {
    kind: 'http',
    ffmpeg: 'https://evermeet.cx/ffmpeg/getrelease/zip',
    ffprobe: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
    ext: ''
  },
  'x86_64-pc-windows-msvc': {
    kind: 'http',
    ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
    ffprobe: null, // BtbN archive includes both binaries
    ext: '.exe'
  }
}

function detectHostTriple () {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    const m = out.match(/^host:\s*(\S+)/m)
    if (m) return m[1]
  } catch { /* fall through */ }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc'
  throw new Error('Unsupported platform — wgr-clip targets macOS and Windows only.')
}

async function download (url, dest) {
  console.log(`[fetch-ffmpeg]   GET ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

function extractZip (zipPath, destDir) {
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`], { stdio: 'inherit' })
    : spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`Extraction failed (exit ${r.status})`)
}

function findBinary (dir, name) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === name || entry.name === `${name}.exe`) return full
    }
  }
  return null
}

function verifyBinary (path) {
  const r = spawnSync(path, ['-version'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`Sanity check failed: ${path} -version exited ${r.status}\n${r.stderr}`)
  console.log(`[fetch-ffmpeg]   ✓ ${(r.stdout || '').split('\n')[0]}`)
}

function copyBrewBinaries (triple, ext) {
  // Detect the Homebrew prefix (arm64 → /opt/homebrew, x86_64 → /usr/local).
  const prefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local'
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const src = `${prefix}/bin/${tool}`
    if (!existsSync(src)) {
      throw new Error(`${tool} not found at ${src}. Install with: brew install ffmpeg`)
    }
    const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
    copyFileSync(src, dest)
    chmodSync(dest, 0o755)
    verifyBinary(dest)
  }
}

async function fetchTriple (triple) {
  const src = SOURCES[triple]
  if (!src) throw new Error(`No download source for triple ${triple}`)
  const ext = src.ext

  const expected = ['ffmpeg', 'ffprobe'].map(t => join(BIN_DIR, `${t}-${triple}${ext}`))
  if (expected.every(p => existsSync(p))) {
    let allOk = true
    for (const p of expected) {
      try { verifyBinary(p) } catch { allOk = false }
    }
    if (allOk) {
      console.log(`[fetch-ffmpeg] ${triple}: both binaries present and valid — skip.`)
      return
    }
    console.log(`[fetch-ffmpeg] ${triple}: existing binaries broken — refetch.`)
    for (const p of expected) rmSync(p, { force: true })
  }

  if (src.kind === 'brew') {
    console.log(`[fetch-ffmpeg] ${triple}: copying from Homebrew`)
    copyBrewBinaries(triple, ext)
    return
  }

  // Single-archive case (Windows BtbN ships both binaries in one zip)
  if (!src.ffprobe) {
    const work = join(tmpdir(), `wgr-clip-fetch-${triple}-${Date.now()}`)
    mkdirSync(work, { recursive: true })
    const archive = join(work, 'archive.zip')
    await download(src.ffmpeg, archive)
    if (statSync(archive).size < 1024) throw new Error(`Archive too small: ${statSync(archive).size}B`)
    extractZip(archive, work)
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const found = findBinary(work, tool)
      if (!found) throw new Error(`${tool} not found inside archive`)
      const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
      chmodSync(found, 0o755)
      // copy+unlink instead of rename — GH Windows runners place temp on C:
      // and the workspace on D:, which makes rename throw EXDEV.
      copyFileSync(found, dest)
      rmSync(found, { force: true })
      chmodSync(dest, 0o755)
      verifyBinary(dest)
    }
    rmSync(work, { recursive: true, force: true })
    return
  }

  // Two-archive case (evermeet ships ffmpeg and ffprobe separately)
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const url = src[tool]
    const work = join(tmpdir(), `wgr-clip-fetch-${tool}-${triple}-${Date.now()}`)
    mkdirSync(work, { recursive: true })
    const archive = join(work, 'archive.zip')
    await download(url, archive)
    if (statSync(archive).size < 1024) throw new Error(`Archive too small: ${statSync(archive).size}B`)
    extractZip(archive, work)
    const found = findBinary(work, tool)
    if (!found) throw new Error(`${tool} not found inside ${url}`)
    const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
    chmodSync(found, 0o755)
    copyFileSync(found, dest)
    rmSync(found, { force: true })
    chmodSync(dest, 0o755)
    verifyBinary(dest)
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Tauri 2 with `--target universal-apple-darwin` looks for sidecars named
 * `ffmpeg-universal-apple-darwin` (it does NOT lipo per-arch binaries
 * automatically). After fetching both macOS arches we merge them with `lipo`.
 */
function makeUniversalMacBinaries () {
  if (process.platform !== 'darwin') return
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const arm = join(BIN_DIR, `${tool}-aarch64-apple-darwin`)
    const x64 = join(BIN_DIR, `${tool}-x86_64-apple-darwin`)
    const out = join(BIN_DIR, `${tool}-universal-apple-darwin`)
    if (!existsSync(arm) || !existsSync(x64)) continue
    if (existsSync(out)) {
      try { verifyBinary(out); continue } catch { /* refresh */ }
    }
    const r = spawnSync('lipo', ['-create', arm, x64, '-output', out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`lipo failed for ${tool} (exit ${r.status})`)
    chmodSync(out, 0o755)
    verifyBinary(out)
  }
}

async function main () {
  mkdirSync(BIN_DIR, { recursive: true })

  const allTargets = process.argv.includes('--all-targets')
  const host = detectHostTriple()

  let triples
  if (allTargets) {
    if (process.platform === 'darwin') triples = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
    else if (process.platform === 'win32') triples = ['x86_64-pc-windows-msvc']
    else triples = []
  } else {
    triples = [host]
  }

  console.log(`[fetch-ffmpeg] target triples: ${triples.join(', ')}`)
  for (const triple of triples) {
    await fetchTriple(triple)
  }

  // On macOS, also produce a universal lipo binary so Tauri's
  // `--target universal-apple-darwin` build picks it up.
  if (allTargets && process.platform === 'darwin') {
    makeUniversalMacBinaries()
    triples.push('universal-apple-darwin')
  }

  writeFileSync(join(BIN_DIR, '.fetched'), JSON.stringify({ at: new Date().toISOString(), triples }, null, 2))
  console.log('[fetch-ffmpeg] done.')
}

main().catch((err) => {
  console.error('[fetch-ffmpeg] FAILED:', err.message)
  process.exit(1)
})
