use super::{
    preset::build_args, probe::probe, JobCancelledEvent, JobDoneEvent, JobErrorEvent, Preset,
    ProgressTick,
};
use crate::errors::JobError;
use crate::hw_accel::HwAccel;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub const STDERR_TAIL_LINES: usize = 50;
const PROGRESS_DEBOUNCE_MS: u64 = 250;

pub const EV_PROGRESS: &str = "transcode://progress";
pub const EV_DONE: &str = "transcode://done";
pub const EV_ERROR: &str = "transcode://error";
pub const EV_CANCELLED: &str = "transcode://cancelled";

pub struct EncodeOutcome {
    pub stderr_tail: Vec<String>,
}

/// Run a single transcode job to completion or until cancelled.
///
/// Pipeline: probe → spawn ffmpeg → multiplex stdout (progress) and stderr
/// (ring buffer + log) → emit events → on exit, classify success/error.
pub async fn run_job(
    app: AppHandle,
    job_id: Uuid,
    input: &Path,
    output: &Path,
    preset: Preset,
    hw: HwAccel,
    cancel: CancellationToken,
) -> Result<EncodeOutcome, JobError> {
    // 1. Pre-flight: input exists, output dir writable, probe duration.
    if !input.exists() {
        let err = JobError::InputNotFound(input.display().to_string());
        emit_error(&app, job_id, err.clone(), Vec::new());
        return Err(err);
    }
    ensure_output_writable(output).map_err(|e| {
        let err = JobError::OutputWriteError(e);
        emit_error(&app, job_id, err.clone(), Vec::new());
        err
    })?;

    let probed = match probe(&app, input).await {
        Ok(p) => p,
        Err(e) => {
            emit_error(&app, job_id, e.clone(), Vec::new());
            return Err(e);
        }
    };
    let duration_us = probed.duration_us;

    // 2. Build ffmpeg argv
    let args = build_args(preset, hw, input, output);
    log::info!(target: "transcode", "ffmpeg argv for job {job_id}: {args:?}");

    // 3. Spawn
    let cmd = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| JobError::Internal(format!("ffmpeg sidecar unavailable: {e}")))?
        .args(args.clone());

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| JobError::Internal(format!("ffmpeg spawn failed: {e}")))?;

    // 4. Multiplex events
    let mut stderr_tail: VecDeque<String> = VecDeque::with_capacity(STDERR_TAIL_LINES);
    let mut stdout_buffer = String::new();
    let mut last_emit = Instant::now() - Duration::from_millis(PROGRESS_DEBOUNCE_MS + 1);
    let mut last_tick = ProgressTick {
        job_id,
        percent: 0.0,
        speed_x: 0.0,
        eta_s: 0,
        fps: 0.0,
    };
    let mut exit_code: Option<i32> = None;

    loop {
        tokio::select! {
            biased;

            _ = cancel.cancelled() => {
                let _ = child.kill();
                // Drain remaining events briefly so the child is fully reaped
                let drain_deadline = Instant::now() + Duration::from_millis(500);
                while Instant::now() < drain_deadline {
                    match tokio::time::timeout(Duration::from_millis(50), rx.recv()).await {
                        Ok(Some(_)) => continue,
                        _ => break,
                    }
                }
                cleanup_partial(output).await;
                emit_cancelled(&app, job_id);
                return Err(JobError::Cancelled);
            }

            ev = rx.recv() => {
                match ev {
                    Some(CommandEvent::Stdout(buf)) => {
                        stdout_buffer.push_str(&String::from_utf8_lossy(&buf));
                        consume_progress_blocks(
                            &mut stdout_buffer,
                            duration_us,
                            &mut last_tick,
                            &app,
                            job_id,
                            &mut last_emit,
                        );
                    }
                    Some(CommandEvent::Stderr(buf)) => {
                        for line in String::from_utf8_lossy(&buf).lines() {
                            let line = line.trim_end().to_string();
                            if line.is_empty() { continue; }
                            log::warn!(target: "ffmpeg", "{line}");
                            if stderr_tail.len() == STDERR_TAIL_LINES {
                                stderr_tail.pop_front();
                            }
                            stderr_tail.push_back(line);
                        }
                    }
                    Some(CommandEvent::Terminated(p)) => {
                        exit_code = p.code;
                        break;
                    }
                    Some(_) => {}
                    None => break,
                }
            }
        }
    }

    let stderr_tail_vec: Vec<String> = stderr_tail.iter().cloned().collect();

    match exit_code {
        Some(0) => {
            // Final tick at 100%
            let final_tick = ProgressTick {
                job_id,
                percent: 1.0,
                speed_x: last_tick.speed_x,
                eta_s: 0,
                fps: last_tick.fps,
            };
            let _ = app.emit(EV_PROGRESS, &final_tick);
            let _ = app.emit(
                EV_DONE,
                &JobDoneEvent {
                    job_id,
                    output: output.to_path_buf(),
                },
            );
            Ok(EncodeOutcome {
                stderr_tail: stderr_tail_vec,
            })
        }
        Some(code) => {
            let err = classify_error(code, &stderr_tail_vec);
            cleanup_partial(output).await;
            emit_error(&app, job_id, err.clone(), stderr_tail_vec.clone());
            Err(err)
        }
        None => {
            let err = JobError::Internal("ffmpeg exited without status".into());
            cleanup_partial(output).await;
            emit_error(&app, job_id, err.clone(), stderr_tail_vec.clone());
            Err(err)
        }
    }
}

fn consume_progress_blocks(
    buffer: &mut String,
    duration_us: u64,
    last_tick: &mut ProgressTick,
    app: &AppHandle,
    job_id: Uuid,
    last_emit: &mut Instant,
) {
    // ffmpeg -progress writes key=value lines, with `progress=continue|end` as
    // the block terminator. We split on those terminators and parse each block.
    let mut consumed = 0usize;
    let mut current = std::collections::HashMap::<String, String>::new();
    let mut idx = 0usize;

    while let Some(eol) = buffer[idx..].find('\n') {
        let line_end = idx + eol;
        let line = buffer[idx..line_end].trim().to_string();
        idx = line_end + 1;

        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().to_string();
            let val = v.trim().to_string();
            if key == "progress" {
                // End of a block — emit a tick if debounce allows
                update_tick_from_map(&current, duration_us, job_id, last_tick);
                if last_emit.elapsed() >= Duration::from_millis(PROGRESS_DEBOUNCE_MS) {
                    let _ = app.emit(EV_PROGRESS, &*last_tick);
                    *last_emit = Instant::now();
                }
                current.clear();
                consumed = idx;
                if val == "end" {
                    break;
                }
            } else {
                current.insert(key, val);
            }
        }
    }

    if consumed > 0 {
        buffer.drain(..consumed);
    }
}

fn update_tick_from_map(
    map: &std::collections::HashMap<String, String>,
    duration_us: u64,
    job_id: Uuid,
    tick: &mut ProgressTick,
) {
    let out_time_us: u64 = map
        .get("out_time_us")
        .and_then(|s| s.parse().ok())
        .or_else(|| map.get("out_time_ms").and_then(|s| s.parse().ok()))
        .unwrap_or(0);

    let speed = map
        .get("speed")
        .and_then(|s| s.trim_end_matches('x').trim().parse::<f32>().ok())
        .unwrap_or(0.0);

    let fps = map.get("fps").and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);

    let percent = if duration_us > 0 {
        (out_time_us as f32 / duration_us as f32).clamp(0.0, 0.999)
    } else {
        0.0
    };

    let eta_s = if duration_us > 0 && speed > 0.01 {
        let remaining_us = duration_us.saturating_sub(out_time_us) as f32;
        ((remaining_us / 1_000_000.0) / speed).max(0.0) as u32
    } else {
        0
    };

    tick.job_id = job_id;
    tick.percent = percent;
    tick.speed_x = speed;
    tick.fps = fps;
    tick.eta_s = eta_s;
}

fn classify_error(code: i32, stderr_tail: &[String]) -> JobError {
    let joined = stderr_tail.join("\n");
    let lower = joined.to_lowercase();

    if lower.contains("no such file") || lower.contains("does not exist") {
        return JobError::InputNotFound(first_meaningful_line(stderr_tail));
    }
    if lower.contains("permission denied") || lower.contains("access is denied") {
        return JobError::OutputWriteError(first_meaningful_line(stderr_tail));
    }
    if lower.contains("unknown encoder")
        || lower.contains("decoder not found")
        || lower.contains("invalid data found")
        || lower.contains("could not find codec")
    {
        return JobError::UnsupportedCodec(first_meaningful_line(stderr_tail));
    }

    JobError::FfmpegCrashed {
        exit_code: code,
        stderr_tail: stderr_tail
            .iter()
            .rev()
            .take(20)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn first_meaningful_line(lines: &[String]) -> String {
    lines
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn ensure_output_writable(output: &Path) -> Result<(), String> {
    let dir = output
        .parent()
        .ok_or_else(|| "output path has no parent directory".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create output dir: {e}"))?;
    // Probe write access with a 0-byte tempfile next to the target.
    let probe = dir.join(format!(".wgr-clip-write-test-{}", std::process::id()));
    std::fs::write(&probe, b"").map_err(|e| format!("output dir not writable: {e}"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

async fn cleanup_partial(output: &Path) {
    // Windows file-lock: brief retry with backoff
    for attempt in 0..3 {
        match tokio::fs::remove_file(output).await {
            Ok(_) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(e) => {
                log::debug!(target: "transcode", "cleanup attempt {attempt} failed: {e}");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

fn emit_error(app: &AppHandle, job_id: Uuid, error: JobError, stderr_tail: Vec<String>) {
    let _ = app.emit(
        EV_ERROR,
        &JobErrorEvent {
            job_id,
            error,
            stderr_tail,
        },
    );
}

fn emit_cancelled(app: &AppHandle, job_id: Uuid) {
    let _ = app.emit(EV_CANCELLED, &JobCancelledEvent { job_id });
}

/// Resolve an output path: `<input-stem>_<preset>.mp4` in `output_dir`,
/// appending `_2`, `_3`, ... on collision.
pub fn resolve_output_path(input: &Path, output_dir: &Path, preset: Preset) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".into());
    let base = format!("{stem}_{}", preset.slug());
    let mut candidate = output_dir.join(format!("{base}.mp4"));
    let mut n = 2;
    while candidate.exists() {
        candidate = output_dir.join(format!("{base}_{n}.mp4"));
        n += 1;
    }
    candidate
}
