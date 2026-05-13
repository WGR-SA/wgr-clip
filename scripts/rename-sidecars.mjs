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

// Sources upgraded to current ffmpeg (7.x / 8.x). All builds are statically
// linked so they Just Work in a bundled unsigned app.
//   - macOS arm64 → osxexperts.net 7.1.1 (no current evermeet arm64 endpoint)
//   - macOS x64   → evermeet.cx (rolling latest, currently 8.1.1)
//   - Windows x64 → BtbN/FFmpeg-Builds master-latest, GPL (libx264 + nvenc + qsv)
// The arm64/x64 version drift inside the lipo binary is fine — each macOS host
// executes only the slice that matches its CPU.
const OSXEXPERTS_VERSION_TAG = '711' // bump when osxexperts ships 7.1.2 etc.
const SOURCES = {
  'aarch64-apple-darwin': {
    kind: 'osxexperts',
    ffmpegUrl: `https://www.osxexperts.net/ffmpeg${OSXEXPERTS_VERSION_TAG}arm.zip`,
    ffprobeUrl: `https://www.osxexperts.net/ffprobe${OSXEXPERTS_VERSION_TAG}arm.zip`,
    ext: ''
  },
  'x86_64-apple-darwin': {
    kind: 'evermeet',
    ffmpegUrl: 'https://evermeet.cx/ffmpeg/getrelease/zip',
    ffprobeUrl: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
    ext: ''
  },
  'x86_64-pc-windows-msvc': {
    kind: 'btbn',
    archiveUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
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

function isHostTriple (triple) {
  return (
    (process.platform === 'darwin' && triple.endsWith('-apple-darwin') && (
      (process.arch === 'arm64' && triple.startsWith('aarch64')) ||
      (process.arch === 'x64' && triple.startsWith('x86_64'))
    )) ||
    (process.platform === 'win32' && triple === 'x86_64-pc-windows-msvc')
  )
}

async function downloadAndExtract (url, work) {
  mkdirSync(work, { recursive: true })
  const archive = join(work, 'archive.zip')
  await download(url, archive)
  if (statSync(archive).size < 1024) throw new Error(`Archive suspiciously small (${statSync(archive).size}B) — got HTML?`)
  extractZip(archive, work)
}

function placeBinary (foundPath, triple, tool, ext) {
  const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
  chmodSync(foundPath, 0o755)
  // copy+unlink instead of rename — GH Windows runners place TMP on C: and
  // the workspace on D:, which makes fs.rename throw EXDEV.
  copyFileSync(foundPath, dest)
  rmSync(foundPath, { force: true })
  chmodSync(dest, 0o755)
  if (isHostTriple(triple)) verifyBinary(dest)
  else console.log(`[fetch-ffmpeg]   ✓ placed ${tool}-${triple}${ext} (cross-platform, no -version run)`)
  return dest
}

async function fetchTriple (triple) {
  const src = SOURCES[triple]
  if (!src) throw new Error(`No download source for triple ${triple}`)
  const ext = src.ext

  const expected = ['ffmpeg', 'ffprobe'].map(t => join(BIN_DIR, `${t}-${triple}${ext}`))
  if (expected.every(p => existsSync(p))) {
    let allOk = true
    for (const p of expected) {
      try { if (isHostTriple(triple)) verifyBinary(p) } catch { allOk = false }
    }
    if (allOk) {
      console.log(`[fetch-ffmpeg] ${triple}: both binaries present — skip.`)
      return
    }
    for (const p of expected) rmSync(p, { force: true })
  }

  if (src.kind === 'btbn') {
    // BtbN ships ffmpeg.exe + ffprobe.exe inside a single zip under bin/.
    console.log(`[fetch-ffmpeg] ${triple}: BtbN ${src.archiveUrl}`)
    const work = join(tmpdir(), `wgr-clip-fetch-${triple}-${Date.now()}`)
    await downloadAndExtract(src.archiveUrl, work)
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const found = findBinary(work, tool)
      if (!found) throw new Error(`${tool} not found inside BtbN archive`)
      placeBinary(found, triple, tool, ext)
    }
    rmSync(work, { recursive: true, force: true })
    return
  }

  // Both osxexperts and evermeet ship one tool per zip → fetch ffmpeg + ffprobe
  // separately.
  if (src.kind === 'osxexperts' || src.kind === 'evermeet') {
    console.log(`[fetch-ffmpeg] ${triple}: ${src.kind} → ${src.ffmpegUrl}`)
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const url = tool === 'ffmpeg' ? src.ffmpegUrl : src.ffprobeUrl
      const work = join(tmpdir(), `wgr-clip-fetch-${tool}-${triple}-${Date.now()}`)
      await downloadAndExtract(url, work)
      const found = findBinary(work, tool)
      if (!found) throw new Error(`${tool} not found inside ${url}`)
      placeBinary(found, triple, tool, ext)
      rmSync(work, { recursive: true, force: true })
    }
    return
  }

  throw new Error(`Unknown source kind ${src.kind} for ${triple}`)
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
