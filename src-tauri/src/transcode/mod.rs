pub mod encoder;
pub mod preset;
pub mod probe;
pub mod queue;

use crate::errors::JobError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Web1080p,
    FourK,
    Source,
    Custom,
}

impl Preset {
    pub fn slug(&self) -> &'static str {
        match self {
            Preset::Web1080p => "web",
            Preset::FourK => "hd",
            Preset::Source => "source",
            Preset::Custom => "custom",
        }
    }
}

/// User-defined parameters used when `Preset::Custom` is selected. Only the
/// fields relevant to the job's `MediaKind` are read.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct CustomParams {
    /// Video: max output height in pixels. 0 = no clamp.
    pub video_max_height: u32,
    /// Video: x264 CRF 15..32 (lower = better). Mapped to equivalent
    /// hardware-encoder bitrate when VideoToolbox/NVENC/QSV is active.
    pub video_crf: u32,
    /// Video: AAC audio bitrate in kbps (e.g. 128, 192, 256).
    pub video_audio_kbps: u32,
    /// Image: longest side max in pixels. 0 = no clamp.
    pub image_max_dim: u32,
    /// Image: JPEG quality 1..100 (higher = better).
    pub image_quality: u32,
    /// Audio: AAC bitrate in kbps.
    pub audio_kbps: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Video,
    Image,
    Audio,
}

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm", "m4v", "flv", "wmv", "mts", "m2ts", "ts", "3gp",
];
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "gif",
];
const AUDIO_EXTS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "wma", "aiff", "aif",
];

impl MediaKind {
    pub fn from_path(p: &Path) -> Option<MediaKind> {
        let ext = p.extension().and_then(|e| e.to_str())?.to_ascii_lowercase();
        if VIDEO_EXTS.contains(&ext.as_str()) { return Some(MediaKind::Video); }
        if IMAGE_EXTS.contains(&ext.as_str()) { return Some(MediaKind::Image); }
        if AUDIO_EXTS.contains(&ext.as_str()) { return Some(MediaKind::Audio); }
        None
    }

    /// Default output container extension for the kind (lowercase, no dot).
    pub fn output_ext(&self) -> &'static str {
        match self {
            MediaKind::Video => "mp4",
            MediaKind::Image => "jpg",
            MediaKind::Audio => "mp3",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum JobStatus {
    Pending,
    Probing,
    Encoding,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: Uuid,
    pub input: PathBuf,
    pub output: PathBuf,
    pub preset: Preset,
    pub kind: MediaKind,
    pub custom: Option<CustomParams>,
    pub status: JobStatus,
    pub progress: f32,
    pub speed_x: f32,
    pub eta_s: u32,
    pub fps: f32,
    pub duration_us: u64,
    pub stderr_tail: Vec<String>,
    pub error: Option<JobError>,
}

impl Job {
    pub fn new(
        input: PathBuf,
        output: PathBuf,
        preset: Preset,
        kind: MediaKind,
        custom: Option<CustomParams>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            input,
            output,
            preset,
            kind,
            custom,
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
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressTick {
    pub job_id: Uuid,
    pub percent: f32,
    pub speed_x: f32,
    pub eta_s: u32,
    pub fps: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobDoneEvent {
    pub job_id: Uuid,
    pub output: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobErrorEvent {
    pub job_id: Uuid,
    pub error: JobError,
    pub stderr_tail: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobCancelledEvent {
    pub job_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobDiagnostics {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub ffmpeg_version: String,
    pub hw_accel: String,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub preset: Preset,
    pub kind: MediaKind,
    pub args: Vec<String>,
    pub error_kind: String,
    pub stderr_tail: Vec<String>,
    pub timestamp: String,
}
