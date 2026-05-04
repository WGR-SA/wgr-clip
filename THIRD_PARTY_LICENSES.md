# Third-party licenses

wgr-clip ships bundled binaries from the FFmpeg project. These are subject to
their own licenses; the wgr-clip source is MIT.

## FFmpeg / ffprobe

This application bundles unmodified copies of `ffmpeg` and `ffprobe`:

- **macOS (universal)**: static builds from <https://evermeet.cx/ffmpeg/>
  (see the corresponding source distribution at <https://evermeet.cx/ffmpeg/source/>).
  Distributed under the **GNU LGPL v2.1+** with optional GPL components when
  built with `--enable-gpl` (libx264). The exact configuration shipped is
  printed by `ffmpeg -hide_banner -version` from inside the bundle.

- **Windows (x86_64)**: static GPL builds from
  <https://github.com/BtbN/FFmpeg-Builds/releases>. Distributed under the
  **GNU GPL v3** because they include `libx264`, `libx265`, and other
  GPL-licensed components.

The full FFmpeg source for the version we ship is available, on request, by
emailing <hello@wgr.ch>. We will provide a complete, machine-readable copy
matching the binary you received, for as long as we distribute that binary.

The text of the GNU LGPL v2.1, GPL v2, and GPL v3 is available at
<https://www.gnu.org/licenses/>.

## Rust crates

Build-time and runtime crate licenses are aggregated from `cargo` metadata.
A full attribution report can be regenerated at any time with:

```sh
cargo install --quiet cargo-about
cd src-tauri && cargo about generate -o ../THIRD_PARTY_RUST.html
```

## npm packages

Frontend npm package licenses are tracked by your package manager. Generate
a full report with:

```sh
npx license-checker --production --summary
```
