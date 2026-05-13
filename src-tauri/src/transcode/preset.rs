use super::{CustomParams, MediaKind, Preset};
use crate::hw_accel::HwAccel;
use std::path::Path;

/// Build the ffmpeg argv for a (kind, preset) pair. The output container is
/// determined by `MediaKind::output_ext` and reflected in the output path.
/// `custom` is consulted when `preset == Preset::Custom`.
pub fn build_args(
    kind: MediaKind,
    preset: Preset,
    hw: HwAccel,
    input: &Path,
    output: &Path,
    input_height: u32,
    custom: Option<CustomParams>,
) -> Vec<String> {
    match kind {
        MediaKind::Video => video_args(preset, hw, input, output, input_height, custom),
        MediaKind::Image => image_args(preset, input, output, custom),
        MediaKind::Audio => audio_args(preset, input, output, custom),
    }
}

// --- Video ----------------------------------------------------------------

fn video_args(
    preset: Preset,
    hw: HwAccel,
    input: &Path,
    output: &Path,
    input_height: u32,
    custom: Option<CustomParams>,
) -> Vec<String> {
    let codec = hw.h264_codec();
    let mut a: Vec<String> = Vec::with_capacity(40);

    a.push("-hide_banner".into());
    a.push("-y".into());
    a.push("-i".into());
    a.push(input.display().to_string());

    let video_max_h: u32 = match preset {
        Preset::Web1080p => 1080,
        Preset::FourK => 2160,
        Preset::Source => 0,
        Preset::Custom => custom.map(|c| c.video_max_height).unwrap_or(0),
    };
    if video_max_h > 0 {
        a.push("-vf".into());
        // Scale to fit max_h while keeping aspect, only downscale.
        a.push(format!("scale=-2:'min({},ih)'", video_max_h));
    } else {
        a.push("-vf".into());
        a.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
    }

    a.push("-c:v".into());
    a.push(codec.to_string());

    let custom_crf = custom.map(|c| c.video_crf).unwrap_or(0);
    let effective_crf = if preset == Preset::Custom && custom_crf > 0 {
        custom_crf.to_string()
    } else {
        x264_crf(preset)
    };
    let effective_audio_bitrate = if preset == Preset::Custom {
        let kbps = custom.map(|c| c.video_audio_kbps).unwrap_or(0);
        if kbps > 0 { format!("{kbps}k") } else { audio_video_bitrate(preset).into() }
    } else {
        audio_video_bitrate(preset).into()
    };

    match codec {
        "libx264" => {
            a.extend(["-preset", x264_preset(preset), "-crf", &effective_crf].map(String::from));
        }
        "h264_videotoolbox" => {
            let bitrate = if preset == Preset::Custom && custom_crf > 0 {
                // CRF→kbps approximation anchored on output height
                let h = if video_max_h == 0 { input_height.max(720) } else { video_max_h };
                crf_to_kbps(custom_crf, h)
            } else {
                videotoolbox_bitrate_kbps(preset, input_height)
            };
            // Minimal VideoToolbox args — earlier we set -maxrate / -bufsize /
            // -realtime which some inputs (specific MOV containers, 10-bit
            // sources, unusual SAR) rejected with VTPropertyNotSupportedErr.
            // -allow_sw 1 keeps the software fallback available; the encoder.rs
            // retry-with-libx264 path catches anything that still slips through.
            a.extend([
                "-b:v".into(),
                format!("{bitrate}k"),
                "-allow_sw".into(),
                "1".into(),
            ]);
        }
        "h264_nvenc" => {
            let cq = if preset == Preset::Custom && custom_crf > 0 {
                custom_crf.to_string()
            } else {
                nvenc_cq(preset)
            };
            a.extend(
                [
                    "-preset", "p5",
                    "-tune", "hq",
                    "-rc", "vbr",
                    "-cq", &cq,
                    "-b:v", "0",
                ]
                .map(String::from),
            );
        }
        "h264_qsv" => {
            let q = if preset == Preset::Custom && custom_crf > 0 {
                custom_crf.to_string()
            } else {
                qsv_quality(preset)
            };
            a.extend(
                [
                    "-preset", "medium",
                    "-global_quality", &q,
                    "-look_ahead", "1",
                ]
                .map(String::from),
            );
        }
        _ => {}
    }

    a.push("-pix_fmt".into());
    a.push("yuv420p".into());
    a.push("-movflags".into());
    a.push("+faststart".into());

    a.push("-c:a".into());
    a.push("aac".into());
    a.push("-b:a".into());
    a.push(effective_audio_bitrate);

    a.push("-nostats".into());
    a.push("-loglevel".into());
    a.push("error".into());
    a.push("-progress".into());
    a.push("pipe:1".into());

    a.push(output.display().to_string());
    a
}

fn x264_preset(p: Preset) -> &'static str {
    match p {
        Preset::FourK => "slow",
        _ => "fast",
    }
}

fn x264_crf(p: Preset) -> String {
    match p {
        Preset::FourK => "20".into(),
        _ => "22".into(),
    }
}

fn audio_video_bitrate(p: Preset) -> &'static str {
    match p {
        Preset::FourK => "192k",
        _ => "128k",
    }
}

/// Approximate target H.264 bitrate (kbps) for a given x264-style CRF + output
/// height. Used to translate user-picked CRF into a VideoToolbox-compatible
/// bitrate, since hardware encoders ignore -crf.
fn crf_to_kbps(crf: u32, output_height: u32) -> u32 {
    let crf = crf.clamp(15, 32) as f32;
    // Anchor: CRF 22 ≈ 5 Mbps for 1080p. Each CRF unit shifts ~14% (1.14x).
    let base = 5_000.0_f32;
    let shift = (22.0 - crf) * 14.0 / 100.0; // -ve for higher crf
    let bitrate_1080 = base * (1.0 + shift).max(0.2);
    // Scale roughly with pixel count vs 1080p.
    let pixel_ratio = (output_height as f32 / 1080.0).powf(1.5).max(0.25);
    (bitrate_1080 * pixel_ratio).round().max(500.0) as u32
}

fn videotoolbox_bitrate_kbps(preset: Preset, input_height: u32) -> u32 {
    let output_height: u32 = match preset {
        Preset::Web1080p => input_height.min(1080).max(1),
        Preset::FourK => input_height.min(2160).max(1),
        Preset::Source | Preset::Custom => if input_height == 0 { 1080 } else { input_height },
    };
    match output_height {
        h if h <= 480 => 1_500,
        h if h <= 720 => 3_000,
        h if h <= 1080 => 5_000,
        h if h <= 1440 => 10_000,
        h if h <= 2160 => 25_000,
        _ => 40_000,
    }
}

fn nvenc_cq(p: Preset) -> String {
    match p {
        Preset::FourK => "20".into(),
        _ => "23".into(),
    }
}

fn qsv_quality(p: Preset) -> String {
    match p {
        Preset::FourK => "20".into(),
        _ => "23".into(),
    }
}

// --- Image ----------------------------------------------------------------

/// Image args: scale-down with aspect ratio preserved, JPEG output via mjpeg
/// encoder with quality controlled by `-q:v` (1-31, lower = better).
fn image_args(preset: Preset, input: &Path, output: &Path, custom: Option<CustomParams>) -> Vec<String> {
    let max_dim: u32 = match preset {
        Preset::Web1080p => 2000,
        Preset::FourK => 4000,
        Preset::Source => 0,
        Preset::Custom => custom.map(|c| c.image_max_dim).unwrap_or(0),
    };
    // mjpeg q:v scale. ~3 = visually lossless, 5 = good web, 7 = compact.
    let q: String = match preset {
        Preset::Web1080p => "5".into(),
        Preset::FourK => "3".into(),
        Preset::Source => "2".into(),
        Preset::Custom => {
            let q100 = custom.map(|c| c.image_quality).unwrap_or(85).clamp(1, 100);
            // q100 100 → mjpeg q 1 ; q100 1 → mjpeg q 31
            let mapped = ((100 - q100 as i32) * 30 / 99 + 1).clamp(1, 31);
            mapped.to_string()
        }
    };

    let mut a: Vec<String> = Vec::with_capacity(20);
    a.push("-hide_banner".into());
    a.push("-y".into());
    a.push("-i".into());
    a.push(input.display().to_string());

    if max_dim > 0 {
        // Fit within a max_dim square preserving aspect; only downscale (no upscale).
        a.push("-vf".into());
        a.push(format!(
            "scale='if(gte(iw,ih),min({m},iw),-2)':'if(gte(iw,ih),-2,min({m},ih))'",
            m = max_dim
        ));
    }

    a.extend([
        "-frames:v".into(),
        "1".into(),
        "-q:v".into(),
        q,
        "-pix_fmt".into(),
        "yuvj420p".into(),
        "-nostats".into(),
        "-loglevel".into(),
        "error".into(),
        "-progress".into(),
        "pipe:1".into(),
    ]);

    a.push(output.display().to_string());
    a
}

// --- Audio ----------------------------------------------------------------

/// Audio args: MP3 (LAME) — universal compatibility, recognised by every
/// player and CMS. Strip cover-art video stream so the muxer doesn't choke.
fn audio_args(preset: Preset, input: &Path, output: &Path, custom: Option<CustomParams>) -> Vec<String> {
    let bitrate: String = match preset {
        Preset::Web1080p => "128k".into(),
        Preset::FourK => "256k".into(),
        Preset::Source => "192k".into(),
        Preset::Custom => {
            let kbps = custom.map(|c| c.audio_kbps).unwrap_or(192).clamp(32, 320);
            format!("{kbps}k")
        }
    };

    let mut a: Vec<String> = Vec::with_capacity(16);
    a.push("-hide_banner".into());
    a.push("-y".into());
    a.push("-i".into());
    a.push(input.display().to_string());
    a.extend([
        "-vn".into(), // drop cover art / video stream
        "-c:a".into(), "libmp3lame".into(),
        "-b:a".into(), bitrate,
        "-id3v2_version".into(), "3".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-progress".into(), "pipe:1".into(),
    ]);
    a.push(output.display().to_string());
    a
}
