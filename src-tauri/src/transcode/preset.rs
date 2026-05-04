use super::Preset;
use crate::hw_accel::HwAccel;
use std::path::Path;

/// Build the ffmpeg argv for a given preset, codec choice, input and output.
/// All presets always include `-progress pipe:1 -nostats -hide_banner -y -movflags +faststart -pix_fmt yuv420p`.
pub fn build_args(preset: Preset, hw: HwAccel, input: &Path, output: &Path) -> Vec<String> {
    let codec = hw.h264_codec();
    let mut a: Vec<String> = Vec::with_capacity(40);

    // Input
    a.push("-hide_banner".into());
    a.push("-y".into());
    a.push("-i".into());
    a.push(input.display().to_string());

    // Video filter (resolution clamp)
    match preset {
        Preset::Web1080p => {
            a.push("-vf".into());
            // scale to fit within 1920x1080, keep aspect, even dims for yuv420p
            a.push("scale='min(1920,iw)':-2".into());
        }
        Preset::FourK => {
            a.push("-vf".into());
            a.push("scale='min(3840,iw)':-2".into());
        }
        Preset::Source => {
            // Even-out odd dimensions for yuv420p compatibility without resampling
            a.push("-vf".into());
            a.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
        }
    }

    a.push("-c:v".into());
    a.push(codec.to_string());

    // Codec-specific quality + preset
    match codec {
        "libx264" => {
            a.extend(["-preset", x264_preset(preset), "-crf", &x264_crf(preset)].map(String::from));
        }
        "h264_videotoolbox" => {
            // VideoToolbox uses -q:v (1-100, higher=better). Map roughly to perceived libx264 quality.
            // Apple recommends using -allow_sw 1 to fall back to software if hw fails.
            a.extend(
                [
                    "-q:v",
                    &videotoolbox_quality(preset),
                    "-allow_sw",
                    "1",
                    "-realtime",
                    "0",
                ]
                .map(String::from),
            );
        }
        "h264_nvenc" => {
            a.extend(
                [
                    "-preset",
                    "p5",
                    "-tune",
                    "hq",
                    "-rc",
                    "vbr",
                    "-cq",
                    &nvenc_cq(preset),
                    "-b:v",
                    "0",
                ]
                .map(String::from),
            );
        }
        "h264_qsv" => {
            a.extend(
                [
                    "-preset",
                    "medium",
                    "-global_quality",
                    &qsv_quality(preset),
                    "-look_ahead",
                    "1",
                ]
                .map(String::from),
            );
        }
        _ => {}
    }

    // Universal output flags
    a.push("-pix_fmt".into());
    a.push("yuv420p".into());
    a.push("-movflags".into());
    a.push("+faststart".into());

    // Audio
    a.push("-c:a".into());
    a.push("aac".into());
    a.push("-b:a".into());
    a.push(audio_bitrate(preset).into());

    // Progress reporting
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

fn audio_bitrate(p: Preset) -> &'static str {
    match p {
        Preset::FourK => "192k",
        _ => "128k",
    }
}

// VideoToolbox quality range 1-100 (higher = better). 60 ≈ libx264 crf 22 visually.
fn videotoolbox_quality(p: Preset) -> String {
    match p {
        Preset::FourK => "70".into(),
        _ => "60".into(),
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
