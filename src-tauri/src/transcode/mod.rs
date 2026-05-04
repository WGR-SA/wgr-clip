pub mod encoder;
pub mod preset;
pub mod probe;
pub mod queue;

use crate::errors::JobError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Web1080p,
    FourK,
    Source,
}

impl Preset {
    pub fn slug(&self) -> &'static str {
        match self {
            Preset::Web1080p => "web1080p",
            Preset::FourK => "4k",
            Preset::Source => "source",
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
    pub fn new(input: PathBuf, output: PathBuf, preset: Preset) -> Self {
        Self {
            id: Uuid::new_v4(),
            input,
            output,
            preset,
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
    pub args: Vec<String>,
    pub error_kind: String,
    pub stderr_tail: Vec<String>,
    pub timestamp: String,
}
