#!/usr/bin/env node
/**
 * Generate a WGR app icon at 1024×1024 PNG.
 * Layout: macOS squircle background, lowercase product label centered on its
 * x-height (Migra Extrabold), wgr logo below as small signature.
 *
 * Usage:
 *   node scripts/generate-icon.mjs                 # defaults: label=clip
 *   node scripts/generate-icon.mjs --label desk    # custom label
 *   node scripts/generate-icon.mjs --label desk --out /path/to/icon-1024.png
 *
 * The Migra woff2 isn't readable directly by @napi-rs/canvas, so we
 * decompress it to a TTF buffer in-memory via wawoff2.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, Image } from '@napi-rs/canvas'
import { decompress } from 'wawoff2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
function flag (name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LABEL = flag('--label', 'clip').toLowerCase()
const OUT_PATH = flag('--out', join(ROOT, 'src-tauri/icons/icon-1024.png'))

const SIZE = 1024
const BG = '#232323'
const FG = '#FDF7F1'

// macOS Big Sur+ icon template: ~10% margin all around, 22.37% corner radius.
// Rendered on a transparent 1024×1024 canvas so Dock + Finder show the proper
// rounded shape (matching Apple's HIG and the wgr app icon style).
const MARGIN = 100
const INNER = SIZE - MARGIN * 2 // 824
const RADIUS = Math.round(INNER * 0.2237) // ≈ 184

async function registerMigra () {
  const woff2 = readFileSync(join(ROOT, 'public/fonts/Migra-Extrabold.woff2'))
  const ttf = Buffer.from(await decompress(woff2))
  const tmpTtf = join(ROOT, 'src-tauri/icons/.migra.ttf')
  mkdirSync(dirname(tmpTtf), { recursive: true })
  writeFileSync(tmpTtf, ttf)
  GlobalFonts.registerFromPath(tmpTtf, 'Migra')
}

async function loadLogoImage () {
  const svg = readFileSync(join(ROOT, 'public/img/logo.svg'), 'utf8')
  const img = new Image()
  img.src = Buffer.from(svg, 'utf8')
  return img
}

function drawRoundedRect (ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawSquircleBackground (ctx) {
  ctx.fillStyle = BG
  drawRoundedRect(ctx, MARGIN, MARGIN, INNER, INNER, RADIUS)
  ctx.fill()
}

/**
 * Lockup centered on the x-height midline of `clip`. We use the lowercase "c"
 * (no ascender, no descender) as the reference: the vertical middle of "c" is
 * placed at the canvas center. This makes the asymmetric ascenders ("l", "i")
 * and the "p" descender push the visual block downward, sitting lower in the
 * frame which reads more balanced than centering the full bounding box.
 */
async function drawLockup (ctx) {
  const logo = await loadLogoImage()
  const aspect = 120 / 287
  const wgrW = 150
  const wgrH = wgrW * aspect
  const gap = 36

  ctx.fillStyle = FG
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Auto-fit font size: start at 460px and shrink until the rendered label
  // fits comfortably inside the squircle interior with 40px breathing room.
  const maxLabelW = INNER - 80
  let fontSize = 460
  ctx.font = `800 ${fontSize}px Migra`
  while (ctx.measureText(LABEL).width > maxLabelW && fontSize > 200) {
    fontSize -= 10
    ctx.font = `800 ${fontSize}px Migra`
  }

  // x-height: pick the first lowercase non-ascender letter in the label, or
  // "x" as a safe fallback. Migra has consistent x-heights across "a-z minus
  // ascenders/descenders" so any plain letter works.
  const xRefChar = [...LABEL].find(c => 'aceimnorsuvwxz'.includes(c)) ?? 'x'
  const xHeight = ctx.measureText(xRefChar).actualBoundingBoxAscent
  // Anchor: midpoint of the x-height body sits at canvas vertical center.
  const labelBaseline = SIZE / 2 + xHeight / 2

  ctx.fillText(LABEL, SIZE / 2, labelBaseline)

  const labelDescent = ctx.measureText(LABEL).actualBoundingBoxDescent
  const wgrTop = labelBaseline + labelDescent + gap
  ctx.drawImage(logo, (SIZE - wgrW) / 2, wgrTop, wgrW, wgrH)
}

async function main () {
  await registerMigra()
  const canvas = createCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d')

  // Squircle background on a transparent canvas (macOS style).
  drawSquircleBackground(ctx)

  // Stacked brand+product lockup, vertically centered on the squircle.
  await drawLockup(ctx)

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, canvas.toBuffer('image/png'))
  console.log(`[icon] wrote ${OUT_PATH} (label="${LABEL}")`)
}

main().catch((err) => {
  console.error('[icon] FAILED:', err.message)
  process.exit(1)
})
