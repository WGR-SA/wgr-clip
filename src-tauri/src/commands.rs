use crate::errors::AppError;
use crate::transcode::{encoder, CropRect, CustomParams, Job, JobDiagnostics, JobStatus, MediaKind, Preset};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

const MAX_BATCH: usize = 10_000;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub hw_accel: String,
    pub ffmpeg_version: String,
}

#[derive(Debug, Serialize)]
pub struct MediaSize {
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn probe_media_size(app: AppHandle, input: PathBuf) -> Result<MediaSize, AppError> {
    let p = crate::transcode::probe::probe(&app, &input).await?;
    Ok(MediaSize { width: p.width, height: p.height })
}

/// One downscaled JPEG frame to stdout. Same decoder as the final encode, so
/// the fractional crop drawn on this preview maps 1:1 onto the output.
pub fn preview_args(input: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input.display().to_string(),
        "-vf".into(),
        "scale='if(gte(iw,ih),min(1200,iw),-2)':'if(gte(iw,ih),-2,min(1200,ih))'".into(),
        "-frames:v".into(),
        "1".into(),
        "-f".into(),
        "image2pipe".into(),
        "-c:v".into(),
        "mjpeg".into(),
        "-q:v".into(),
        "4".into(),
        "-pix_fmt".into(),
        "yuvj420p".into(),
        "pipe:1".into(),
    ]
}

#[tauri::command]
pub async fn render_crop_preview(app: AppHandle, input: PathBuf) -> Result<tauri::ipc::Response, AppError> {
    use tauri_plugin_shell::{process::CommandEvent, ShellExt};

    // set_raw_out: the default reader splits on newlines and would corrupt JPEG bytes.
    let cmd = app
        .shell()
        .sidecar("ffmpeg")?
        .args(preview_args(&input))
        .set_raw_out(true);
    let (mut rx, _child) = cmd.spawn()?;

    let mut bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code: i32 = -1;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(buf) => bytes.extend_from_slice(&buf),
            CommandEvent::Stderr(buf) => stderr.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Terminated(p) => {
                exit_code = p.code.unwrap_or(-1);
                break;
            }
            _ => {}
        }
    }

    if exit_code != 0 || bytes.is_empty() {
        return Err(AppError::Other(format!(
            "preview failed (exit {exit_code}): {}",
            stderr.trim()
        )));
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// Recursively expand a list of dropped paths into a flat list of supported
/// media files (video, image or audio). Folders walked depth 5; non-media
/// files are filtered out. Total cap of MAX_BATCH protects against runaway
/// drops on huge folders.
#[tauri::command]
pub fn expand_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    'outer: for p in paths {
        if !p.exists() {
            continue;
        }
        if p.is_file() {
            if MediaKind::from_path(&p).is_some() {
                out.push(p);
                if out.len() >= MAX_BATCH {
                    break;
                }
            }
            continue;
        }
        for entry in WalkDir::new(&p).max_depth(5).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() && MediaKind::from_path(entry.path()).is_some() {
                out.push(entry.path().to_path_buf());
                if out.len() >= MAX_BATCH {
                    break 'outer;
                }
            }
        }
    }
    out
}

#[derive(Debug, Deserialize)]
pub struct StartJobsArgs {
    pub inputs: Vec<PathBuf>,
    pub preset: Preset,
    #[serde(default)]
    pub custom: Option<CustomParams>,
    pub output_dir: Option<PathBuf>,
    /// Applies to every input of the call; the frontend sends one input per
    /// cropped job.
    #[serde(default)]
    pub crop: Option<CropRect>,
}

#[tauri::command]
pub fn start_jobs(state: State<'_, AppState>, args: StartJobsArgs) -> Result<Vec<Uuid>, AppError> {
    let mut ids = Vec::with_capacity(args.inputs.len());
    // Outputs of jobs still in flight don't exist on disk yet but are taken:
    // a second crop of the same source must not overwrite the first.
    let mut claimed: HashSet<PathBuf> = state
        .queue
        .jobs
        .iter()
        .filter(|j| matches!(j.status, JobStatus::Pending | JobStatus::Probing | JobStatus::Encoding))
        .map(|j| j.output.clone())
        .collect();
    for input in args.inputs {
        let kind = MediaKind::from_path(&input).unwrap_or(MediaKind::Video);
        let dir = match &args.output_dir {
            Some(d) => d.clone(),
            None => default_output_dir(&input),
        };
        std::fs::create_dir_all(&dir).map_err(|e| AppError::Other(e.to_string()))?;
        let output = encoder::resolve_output_path(&input, &dir, args.preset, kind, args.crop.is_some(), &claimed);
        claimed.insert(output.clone());
        let id = state
            .queue
            .enqueue(input, output, args.preset, kind, args.custom, args.crop);
        ids.push(id);
    }
    Ok(ids)
}

fn default_output_dir(input: &Path) -> PathBuf {
    // Default output sits next to the source file so users find it without
    // hunting through subfolders. Output filename is suffixed with the preset.
    input
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, id: Uuid) {
    state.queue.cancel(id);
}

#[tauri::command]
pub fn cancel_all(state: State<'_, AppState>) {
    state.queue.cancel_all();
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> Vec<Job> {
    state
        .queue
        .jobs
        .iter()
        .map(|e| e.value().clone())
        .collect()
}

#[tauri::command]
pub fn retry_job(state: State<'_, AppState>, id: Uuid) -> Result<Uuid, AppError> {
    let (input, output, preset, kind, custom, crop) = match state.queue.jobs.get(&id) {
        Some(j) => (
            j.input.clone(),
            j.output.clone(),
            j.preset,
            j.kind,
            j.custom,
            j.crop,
        ),
        None => return Err(AppError::Other(format!("job {id} not found"))),
    };
    state.queue.jobs.remove(&id);
    let new_id = state.queue.enqueue(input, output, preset, kind, custom, crop);
    Ok(new_id)
}

#[tauri::command]
pub fn get_diagnostics(
    state: State<'_, AppState>,
    app: AppHandle,
    id: Uuid,
) -> Result<JobDiagnostics, AppError> {
    let j = state
        .queue
        .jobs
        .get(&id)
        .ok_or_else(|| AppError::Other(format!("job {id} not found")))?;

    let app_version = app.package_info().version.to_string();
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let hw = format!("{:?}", *state.hw_accel.read());
    let preset = j.preset;
    let kind = j.kind;
    let custom = j.custom;
    let crop = j.crop;
    // Best-effort: we don't re-probe here, height defaults trigger the
    // 1080p bitrate row which is the most common case.
    let args = crate::transcode::preset::build_args(
        kind,
        preset,
        *state.hw_accel.read(),
        &j.input,
        &j.output,
        0,
        custom,
        crop,
    )
    .into_iter()
    .collect();
    let error_kind = j
        .error
        .as_ref()
        .map(|e| {
            let v = serde_json::to_value(e).unwrap_or(serde_json::Value::Null);
            v.get("kind").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string()
        })
        .unwrap_or_else(|| "None".into());

    let ffmpeg_version = state.ffmpeg_version.read().clone();

    Ok(JobDiagnostics {
        app_version,
        os,
        arch,
        ffmpeg_version,
        hw_accel: hw,
        input_path: j.input.clone(),
        output_path: j.output.clone(),
        preset,
        kind,
        args,
        error_kind,
        stderr_tail: j.stderr_tail.clone(),
        timestamp: chrono_now_iso(),
    })
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // crude RFC3339-ish without an extra dep — UTC with epoch fallback
    format!("epoch+{secs}s")
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>, app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        hw_accel: format!("{:?}", *state.hw_accel.read()),
        ffmpeg_version: state.ffmpeg_version.read().clone(),
    }
}

#[tauri::command]
pub async fn open_logs_dir(app: AppHandle) -> Result<(), AppError> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::Other(format!("log dir resolution failed: {e}")))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Other(e.to_string()))?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: PathBuf) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_args_render_one_downscaled_jpeg_to_stdout() {
        let a = preview_args(Path::new("/pics/in.heic"));
        assert_eq!(a.last().unwrap(), "pipe:1");
        assert!(a.windows(2).any(|w| w[0] == "-frames:v" && w[1] == "1"));
        assert!(a.windows(2).any(|w| w[0] == "-f" && w[1] == "image2pipe"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "mjpeg"));
        let vf = a.iter().position(|x| x == "-vf").map(|i| a[i + 1].clone()).unwrap();
        assert!(vf.contains("min(1200,iw)") && vf.contains("min(1200,ih)"), "{vf}");
    }
}
