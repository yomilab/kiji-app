# Third-party notices

KiJi (`kiji-app`) is licensed under **GPL-3.0-or-later** (see [LICENSE](LICENSE)).

This file lists **major** open-source components shipped in or linked into release builds. It is not an exhaustive transitive inventory. Regenerate before each public release (commands at the end).

**License elections (dual-licensed components used under the named license):**

- **DOMPurify** — used under **Apache-2.0** (also offered as MPL-2.0).
- **JSZip** — used under **MIT** (also offered as GPL-3.0-or-later).

---

## Direct JavaScript / TypeScript dependencies (renderer)

Bundled via Vite from `package.json` `dependencies`.

| Package | Version (range) | License |
| --- | --- | --- |
| `@emoji-mart/data` | ^1.2.1 | MIT |
| `@emoji-mart/react` | ^1.1.1 | MIT |
| `@emotion/react` | ^11.14.0 | MIT |
| `@emotion/styled` | ^11.14.1 | MIT |
| `@mozilla/readability` | ^0.6.0 | Apache-2.0 |
| `@mui/icons-material` | ^7.3.11 | MIT |
| `@mui/material` | ^7.3.11 | MIT |
| `@tanstack/react-virtual` | ^3.14.2 | MIT |
| `@tauri-apps/api` | ^2 | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-opener` | ^2 | MIT OR Apache-2.0 |
| `cheerio` | ^1.2.0 | MIT |
| `chroma-js` | ^3.2.0 | BSD-3-Clause AND Apache-2.0 |
| `colorthief` | ^2.7.0 | MIT |
| `defuddle` | ^0.18.1 | MIT |
| `dompurify` | ^3.4.8 | Apache-2.0 (elected; also MPL-2.0) |
| `emoji-mart` | ^5.6.0 | MIT |
| `fast-xml-parser` | ^5.8.0 | MIT |
| `feedsmith` | ^3.0.0-next.6 | MIT |
| `howler` | ^2.2.4 | MIT |
| `jszip` | ^3.10.1 | MIT (elected; also GPL-3.0-or-later) |
| `linkedom` | ^0.18.12 | ISC |
| `lite-youtube-embed` | ^0.3.4 | Apache-2.0 |
| `motion` | ^12.40.0 | MIT |
| `prismjs` | ^1.30.0 | MIT |
| `react` | ^18.3.1 | MIT |
| `react-dom` | ^18.3.1 | MIT |
| `react-virtuoso` | ^4.18.7 | MIT |
| `turndown` | ^7.2.4 | MIT |

### Major transitive JavaScript dependencies

Production bundle also includes dependencies of the packages above (for example Emotion, Babel runtime, MUI internals, `feedsmith` / XML / DOM helpers). Production npm tree snapshot (2026-06-08): ~180 packages — predominantly **MIT**, plus **BSD-2-Clause**, **ISC**, **Apache-2.0**, **0BSD**.

| Package | Pulled in by | License | Notes |
| --- | --- | --- | --- |
| `sharp` | `colorthief` | MIT | Native image bindings |
| `@img/sharp-libvips-*` | `sharp` | **LGPL-3.0-or-later** | **libvips** native library — LGPL compliance required in distributed builds (license text + source/relink guidance) |
| `@babel/runtime` | MUI / Emotion | MIT | |
| `fast-xml-parser` / `strnum` | feed / OPML paths | MIT | |
| `htmlparser2` / `parse5` | `cheerio` | MIT | |
| `framer-motion` | `motion` | MIT | |

---

## Direct Rust dependencies (Tauri backend)

From `src-tauri/Cargo.toml` `dependencies` (resolved versions from `Cargo.lock` at audit time).

| Crate | Resolved version | License |
| --- | --- | --- |
| `tauri` | 2.11.2 | Apache-2.0 OR MIT |
| `tauri-plugin-opener` | 2.5.4 | Apache-2.0 OR MIT |
| `tauri-plugin-process` | 2.3.1 | Apache-2.0 OR MIT |
| `tokio` | 1.52.3 | MIT |
| `serde` | 1.0.228 | Apache-2.0 OR MIT |
| `serde_json` | 1.0.150 | Apache-2.0 OR MIT |
| `rusqlite` | 0.39.0 | MIT |
| `chrono` | 0.4.45 | Apache-2.0 OR MIT |
| `reqwest` | 0.13.4 | Apache-2.0 OR MIT |
| `futures-util` | 0.3.32 | Apache-2.0 OR MIT |
| `once_cell` | 1.21.4 | Apache-2.0 OR MIT |
| `rfd` | 0.17.2 | MIT |
| `arboard` | 3.6.1 | Apache-2.0 OR MIT |
| `base64` | 0.22.1 | Apache-2.0 OR MIT |
| `uuid` | 1.23.2 | Apache-2.0 OR MIT |
| `zip` | 2.4.2 | MIT |
| **`html2md`** | 0.2.15 | **GPL-3.0-or-later** |
| `sysinfo` | 0.37.2 | MIT |
| `image` | 0.25.10 | Apache-2.0 OR MIT |
| `objc2` | 0.6.4 | MIT |
| `objc2-app-kit` | 0.3.2 | Apache-2.0 OR MIT OR Zlib |
| `objc2-foundation` | 0.3.2 | MIT |

### Major transitive Rust dependencies

Production Rust tree (2026-06-08): **~500+** crates — mostly **Apache-2.0 OR MIT**, **MIT**, **Unicode-3.0** (ICU), plus:

| Crate | License | Notes |
| --- | --- | --- |
| `cssparser` | MPL-2.0 | HTML parsing stack (via `html2md` / markup crates) |
| `selectors` | MPL-2.0 | |
| `html5ever` / `markup5ever` | Apache-2.0 OR MIT | |
| `libsqlite3-sys` | MIT | SQLite is public domain |
| `rustls` | Apache-2.0 OR ISC OR MIT | TLS |
| `tao` / `wry` / `webview2-com-*` | Apache-2.0 OR MIT | Tauri windowing / webview glue |
| `ring` / `aws-lc-rs` | ISC / OpenSSL-style | Crypto (via `rustls` feature chain) |

---

## Platform runtimes (not shipped as source)

| Component | Role |
| --- | --- |
| **WebKit** (macOS) / **WebView2** (Windows) / **WebKitGTK** (Linux) | System or bundled webview runtime for Tauri |
| **SQLite** | Embedded database engine (public domain) |

---

## Regenerating this list

From the `kiji-app` repository root:

```bash
# Direct npm production licenses
npx license-checker --direct --production

# Full npm production CSV
npx license-checker --production --csv > third-party-npm.csv

# Rust (install once: cargo install cargo-license)
cd src-tauri && cargo license --avoid-build-deps --avoid-dev-deps
```

Update the **Resolved version** column from `package-lock.json` / `Cargo.lock` when preparing a release.

---

## Canonical documentation

Extended licensing notes and GPL compatibility research: `kiji-doc` → `docs/project/project-kiji-open-source-licensing.md`.
