import { z } from 'zod'
import type { CustomParams, Preset, PresetSelection } from '../types/job'

export interface VideoUserPreset {
  id: string
  kind: 'video'
  name: string
  max_width: number
  max_height: number
  crf: number
  audio_kbps: number
}

export interface ImageUserPreset {
  id: string
  kind: 'image'
  name: string
  max_width: number
  max_height: number
  quality: number
}

export interface AudioUserPreset {
  id: string
  kind: 'audio'
  name: string
  kbps: number
}

export type UserPreset = VideoUserPreset | ImageUserPreset | AudioUserPreset

export type ParseUserPresetsResult
  = { ok: true, presets: UserPreset[] }
    | { ok: false, message: string }

const MAX_ID_LENGTH = 40

const dimension = (max: number) => z.int().min(0).max(max).default(0)
const kbps = z.int().min(32).max(320)

const common = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(MAX_ID_LENGTH).optional(),
  name: z.string().trim().min(1).max(60)
}

const userPresetSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('video'),
    max_width: dimension(7680),
    max_height: dimension(4320),
    crf: z.int().min(15).max(32).default(22),
    audio_kbps: kbps.default(128)
  }),
  z.object({
    ...common,
    kind: z.literal('image'),
    max_width: dimension(8000),
    max_height: dimension(8000),
    quality: z.int().min(1).max(100).default(85)
  }),
  z.object({
    ...common,
    kind: z.literal('audio'),
    kbps: kbps.default(128)
  })
]).transform((p): UserPreset => ({ ...p, id: p.id ?? slugify(p.name) }))

const userPresetFileSchema = z.object({
  presets: z.array(userPresetSchema).min(1)
})

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`
    return acc ? `${acc}.${String(seg)}` : String(seg)
  }, '')
}

export function parseUserPresetFile(text: string): ParseUserPresetsResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, message: `JSON invalide : ${(e as Error).message}` }
  }
  const result = userPresetFileSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map(i => `${formatPath(i.path)} : ${i.message}`)
    return { ok: false, message: issues.join(' · ') }
  }
  return { ok: true, presets: result.data.presets }
}

export function toCustomParams(preset: UserPreset, base: CustomParams): CustomParams {
  switch (preset.kind) {
    case 'video':
      return {
        ...base,
        video_max_width: preset.max_width,
        video_max_height: preset.max_height,
        video_crf: preset.crf,
        video_audio_kbps: preset.audio_kbps
      }
    case 'image':
      return {
        ...base,
        image_max_width: preset.max_width,
        image_max_height: preset.max_height,
        image_quality: preset.quality
      }
    case 'audio':
      return { ...base, audio_kbps: preset.kbps }
  }
}

export function mergeUserPresets(existing: UserPreset[], incoming: UserPreset[]): UserPreset[] {
  const out = [...existing]
  for (const preset of incoming) {
    const i = out.findIndex(p => p.id === preset.id)
    if (i >= 0) out[i] = preset
    else out.push(preset)
  }
  return out
}

function describeBox(maxWidth: number, maxHeight: number): string {
  if (maxWidth > 0 && maxHeight > 0) return `≤ ${maxWidth}×${maxHeight} px`
  if (maxWidth > 0) return `≤ ${maxWidth} px de large`
  if (maxHeight > 0) return `≤ ${maxHeight} px de haut`
  return 'Dimensions d\'origine'
}

export function describeUserPreset(preset: UserPreset): string {
  switch (preset.kind) {
    case 'video':
      return `${describeBox(preset.max_width, preset.max_height)} · CRF ${preset.crf} · AAC ${preset.audio_kbps}k`
    case 'image':
      return `${describeBox(preset.max_width, preset.max_height)} · JPEG q${preset.quality}`
    case 'audio':
      return `MP3 ${preset.kbps}k`
  }
}

const USER_PREFIX = 'user:'

export function userSelection(id: string): PresetSelection {
  return `${USER_PREFIX}${id}`
}

export function userIdFromSelection(selection: string): string | null {
  return selection.startsWith(USER_PREFIX) ? selection.slice(USER_PREFIX.length) : null
}

export function isBuiltinPreset(selection: PresetSelection): selection is Preset {
  return !selection.startsWith(USER_PREFIX)
}
