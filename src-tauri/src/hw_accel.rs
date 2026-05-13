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

/// Probe the bundled ffmpeg sidecar for available encoders **and** smoke-test
/// the candidate hardware encoder. A codec listed in `-encoders` only means
/// the static ffmpeg has it compiled in — it doesn't guarantee the user's
/// machine has a working driver/GPU. We force-encode a tiny synthetic frame
/// and fall back to libx264 if it exits non-zero, so the queue never spawns
/// an h264_qsv/nvenc job on a machine that will reject it at runtime.
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
