export type Preset = 'web1080p' | '4k' | 'source' | 'custom'

export type MediaKind = 'video' | 'image' | 'audio'

export interface CustomParams {
  // Video
  video_max_height: number   // 0 = no clamp
  video_crf: number          // 15..32, lower = better
  video_audio_kbps: number   // AAC bitrate for video's audio track
  // Image
  image_max_dim: number      // 0 = no resize
  image_quality: number      // 1..100, higher = better
  // Audio
  audio_kbps: number         // 32..320
}

export type JobStatusState =
  | 'pending'
  | 'probing'
  | 'encoding'
  | 'done'
  | 'error'
  | 'cancelled'

export interface JobError {
  kind:
    | 'InputNotFound'
    | 'ProbeFailed'
    | 'UnsupportedCodec'
    | 'OutputWriteError'
    | 'FfmpegCrashed'
    | 'Cancelled'
    | 'Internal'
  data?: unknown
}

export interface Job {
  id: string
  input: string
  output: string
  preset: Preset
  kind: MediaKind
  custom: CustomParams | null
  status: { state: JobStatusState }
  progress: number
  speed_x: number
  eta_s: number
  fps: number
  duration_us: number
  stderr_tail: string[]
  error: JobError | null
}

export interface ProgressTick {
  job_id: string
  percent: number
  speed_x: number
  eta_s: number
  fps: number
}

export interface JobDoneEvent {
  job_id: string
  output: string
}

export interface JobErrorEvent {
  job_id: string
  error: JobError
  stderr_tail: string[]
}

export interface JobCancelledEvent {
  job_id: string
}

export interface AppInfo {
  version: string
  os: string
  arch: string
  hw_accel: string
  ffmpeg_version: string
}
