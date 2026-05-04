use crate::errors::JobError;
use serde::Deserialize;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub duration_us: u64,
    pub has_audio: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
struct ProbeJson {
    #[serde(default)]
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    nb_frames: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
}

/// Run ffprobe against `input` and return duration + stream metadata.
/// Falls back to estimating duration from frame count / fps when format-level
/// duration is missing (some MOV/MKV/MTS streams).
pub async fn probe(app: &AppHandle, input: &Path) -> Result<ProbeResult, JobError> {
    if !input.exists() {
        return Err(JobError::InputNotFound(input.display().to_string()));
    }

    let input_str = input
        .to_str()
        .ok_or_else(|| JobError::ProbeFailed("non-UTF8 path".into()))?;

    let cmd = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| JobError::ProbeFailed(format!("ffprobe sidecar unavailable: {e}")))?
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            input_str,
        ]);

    let (mut rx, _child) = cmd
        .spawn()
        .map_err(|e| JobError::ProbeFailed(format!("ffprobe spawn failed: {e}")))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code: i32 = -1;

    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(buf) => stdout.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Stderr(buf) => stderr.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Terminated(p) => {
                exit_code = p.code.unwrap_or(-1);
                break;
            }
            _ => {}
        }
    }

    if exit_code != 0 {
        return Err(JobError::ProbeFailed(stderr.trim().to_string()));
    }

    let json: ProbeJson = serde_json::from_str(&stdout)
        .map_err(|e| JobError::ProbeFailed(format!("invalid ffprobe JSON: {e}")))?;

    let video = json
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| JobError::UnsupportedCodec("no video stream".into()))?;

    let duration_us = parse_duration_us(&json).unwrap_or(0);
    let has_audio = json
        .streams
        .iter()
        .any(|s| s.codec_type.as_deref() == Some("audio"));
    let width = video.width.unwrap_or(0);
    let height = video.height.unwrap_or(0);

    Ok(ProbeResult {
        duration_us,
        has_audio,
        width,
        height,
    })
}

fn parse_duration_us(p: &ProbeJson) -> Option<u64> {
    if let Some(s) = &p.format.duration {
        if let Ok(secs) = s.parse::<f64>() {
            if secs > 0.0 {
                return Some((secs * 1_000_000.0) as u64);
            }
        }
    }
    // Fallback: estimate from a video stream's frame count / fps
    let video = p
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))?;

    if let Some(d) = &video.duration {
        if let Ok(secs) = d.parse::<f64>() {
            if secs > 0.0 {
                return Some((secs * 1_000_000.0) as u64);
            }
        }
    }
    let nb = video.nb_frames.as_deref()?.parse::<f64>().ok()?;
    let fps = parse_fraction(video.r_frame_rate.as_deref()?)?;
    if fps <= 0.0 || nb <= 0.0 {
        return None;
    }
    Some(((nb / fps) * 1_000_000.0) as u64)
}

fn parse_fraction(s: &str) -> Option<f64> {
    let mut parts = s.split('/');
    let num: f64 = parts.next()?.parse().ok()?;
    let den: f64 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(1.0);
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}
