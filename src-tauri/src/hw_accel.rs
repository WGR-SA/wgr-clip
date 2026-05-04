use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

/// Hardware encoder available on this machine. Detected once at app start.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HwAccel {
    VideoToolbox,
    Nvenc,
    QuickSync,
    Software,
}

impl HwAccel {
    /// Codec name to pass to `ffmpeg -c:v`.
    pub fn h264_codec(&self) -> &'static str {
        match self {
            HwAccel::VideoToolbox => "h264_videotoolbox",
            HwAccel::Nvenc => "h264_nvenc",
            HwAccel::QuickSync => "h264_qsv",
            HwAccel::Software => "libx264",
        }
    }
}

/// Probe the bundled ffmpeg sidecar for available encoders. Falls back to
/// software if anything goes wrong — better to encode slowly than crash.
pub async fn detect(app: &AppHandle) -> HwAccel {
    let cmd = match app.shell().sidecar("ffmpeg") {
        Ok(c) => c,
        Err(_) => return HwAccel::Software,
    };

    let spawn = cmd.args(["-hide_banner", "-encoders"]).spawn();
    let (mut rx, _child) = match spawn {
        Ok(v) => v,
        Err(_) => return HwAccel::Software,
    };

    let mut text = String::new();
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(buf) => text.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Stderr(buf) => text.push_str(&String::from_utf8_lossy(&buf)),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    if cfg!(target_os = "macos") && text.contains("h264_videotoolbox") {
        HwAccel::VideoToolbox
    } else if cfg!(target_os = "windows") && text.contains("h264_nvenc") {
        HwAccel::Nvenc
    } else if cfg!(target_os = "windows") && text.contains("h264_qsv") {
        HwAccel::QuickSync
    } else {
        HwAccel::Software
    }
}
