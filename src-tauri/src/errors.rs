use serde::Serialize;
use thiserror::Error;

/// User-facing job error categories. Carries enough context for the UI to
/// render a human message + an expandable technical panel.
#[derive(Debug, Clone, Serialize, Error)]
#[serde(tag = "kind", content = "data")]
pub enum JobError {
    #[error("Input file not found: {0}")]
    InputNotFound(String),

    #[error("Cannot probe input: {0}")]
    ProbeFailed(String),

    #[error("Unsupported codec or container: {0}")]
    UnsupportedCodec(String),

    #[error("Cannot write output: {0}")]
    OutputWriteError(String),

    #[error("ffmpeg crashed (exit {exit_code})")]
    FfmpegCrashed {
        exit_code: i32,
        stderr_tail: String,
    },

    #[error("Cancelled by user")]
    Cancelled,

    #[error("Internal error: {0}")]
    Internal(String),
}

impl JobError {
    /// Build a JobError from an arbitrary anyhow/io error.
    pub fn internal(msg: impl Into<String>) -> Self {
        JobError::Internal(msg.into())
    }
}

/// Top-level command error returned to JS. Always serializable as plain string
/// so Tauri's `Result<T, E>` mapping works with serde.
#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Job(#[from] JobError),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<tauri_plugin_shell::Error> for AppError {
    fn from(e: tauri_plugin_shell::Error) -> Self {
        AppError::Other(e.to_string())
    }
}
