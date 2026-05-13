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

/// We default to libx264 software encoding for ALL video jobs. clip's main
/// use case is "compress this file for the web", and libx264 in CRF mode
/// adapts its bitrate to the actual content complexity — static screen
/// recordings drop from ~10 Mb/s to ~1 Mb/s (10× smaller files) because
/// 99% of macroblocks get encoded as zero-bit skips.
///
/// VideoToolbox / NVENC / QuickSync are bitrate-targeted hardware encoders;
/// they're ~3× faster but spend the requested bitrate even on near-static
/// content, producing files 3–10× larger than libx264 for the same input.
/// They make sense for live streaming, not for file-size-driven exports.
///
/// The smoke-test + detection plumbing is kept in place (commented behind
/// `_smoke_test`) so a future "Optimised for speed" toggle can opt back in.
pub async fn detect(_app: &AppHandle) -> HwAccel {
    HwAccel::Software
}

#[allow(dead_code)]
async fn detect_hardware(app: &AppHandle) -> HwAccel {
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

    let candidate = if cfg!(target_os = "macos") && text.contains("h264_videotoolbox") {
        HwAccel::VideoToolbox
    } else if cfg!(target_os = "windows") && text.contains("h264_nvenc") {
        HwAccel::Nvenc
    } else if cfg!(target_os = "windows") && text.contains("h264_qsv") {
        HwAccel::QuickSync
    } else {
        return HwAccel::Software;
    };

    if smoke_test(app, candidate.h264_codec()).await {
        candidate
    } else {
        log::warn!(
            target: "hw_accel",
            "candidate {candidate:?} listed in -encoders but smoke test failed — falling back to libx264"
        );
        HwAccel::Software
    }
}

/// Run a tiny synthetic encode to confirm the hardware encoder actually works
/// on this machine. ~40ms of black at 64×64 → /dev/null. Returns true if
/// ffmpeg exits with status 0.
#[allow(dead_code)]
async fn smoke_test(app: &AppHandle, codec: &str) -> bool {
    let cmd = match app.shell().sidecar("ffmpeg") {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:size=64x64:rate=25:duration=0.04",
        "-c:v",
        codec,
    ];
    // VideoToolbox needs an explicit bitrate, NVENC accepts defaults.
    if codec == "h264_videotoolbox" {
        args.extend(["-b:v", "100k"]);
    }
    args.extend(["-f", "null", "-"]);

    let spawn = cmd.args(args).spawn();
    let (mut rx, _child) = match spawn {
        Ok(v) => v,
        Err(_) => return false,
    };
    let mut exit_code: i32 = -1;
    while let Some(ev) = rx.recv().await {
        if let CommandEvent::Terminated(p) = ev {
            exit_code = p.code.unwrap_or(-1);
            break;
        }
    }
    exit_code == 0
}
