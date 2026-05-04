mod commands;
mod errors;
mod hw_accel;
mod transcode;

use parking_lot::RwLock;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};
use transcode::queue::JobQueue;

pub struct AppState {
    pub hw_accel: Arc<RwLock<hw_accel::HwAccel>>,
    pub ffmpeg_version: Arc<RwLock<String>>,
    pub queue: Arc<JobQueue>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: Some("wgr-clip".into()) }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let hw_accel = Arc::new(RwLock::new(hw_accel::HwAccel::Software));
            let ffmpeg_version = Arc::new(RwLock::new(String::from("unknown")));
            let queue = Arc::new(JobQueue::new(app.handle().clone(), hw_accel.clone()));
            app.manage(AppState {
                hw_accel: hw_accel.clone(),
                ffmpeg_version: ffmpeg_version.clone(),
                queue,
            });

            // Detect hw accel + capture ffmpeg version banner asynchronously
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let detected = hw_accel::detect(&handle).await;
                *hw_accel.write() = detected;
                log::info!(target: "boot", "hw_accel detected: {detected:?}");

                if let Ok(banner) = ffmpeg_banner(&handle).await {
                    *ffmpeg_version.write() = banner;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::expand_paths,
            commands::start_jobs,
            commands::cancel_job,
            commands::cancel_all,
            commands::list_jobs,
            commands::retry_job,
            commands::get_diagnostics,
            commands::get_app_info,
            commands::open_logs_dir,
            commands::reveal_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn ffmpeg_banner(app: &tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::{process::CommandEvent, ShellExt};
    let cmd = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(["-hide_banner", "-version"]);
    let (mut rx, _child) = cmd.spawn().map_err(|e| e.to_string())?;
    let mut out = String::new();
    while let Some(ev) = rx.recv().await {
        if let CommandEvent::Stdout(buf) = ev {
            out.push_str(&String::from_utf8_lossy(&buf));
        } else if matches!(ev, CommandEvent::Terminated(_)) {
            break;
        }
    }
    Ok(out.lines().next().unwrap_or("ffmpeg").trim().to_string())
}
