# Third-party notices

KiJi is **GPL-3.0-or-later** ([LICENSE](LICENSE)). Major open-source components in release builds:

| Component | License | Notes |
| --- | --- | --- |
| **html2md** | GPL-3.0-or-later | Rust — article export |
| **libvips** (`sharp` / `colorthief`) | LGPL-3.0-or-later | Native image stack |
| **DOMPurify** | Apache-2.0 | Also MPL-2.0 |
| **JSZip** | MIT | Also GPL-3.0-or-later |
| **cssparser**, **selectors** | MPL-2.0 | Rust transitive |

## JavaScript (`package.json` dependencies)

| Package | License |
| --- | --- |
| `@emoji-mart/data`, `@emoji-mart/react`, `emoji-mart` | MIT |
| `@emotion/react`, `@emotion/styled` | MIT |
| `@mozilla/readability` | Apache-2.0 |
| `@mui/icons-material`, `@mui/material` | MIT |
| `@tanstack/react-virtual` | MIT |
| `@tauri-apps/api`, `@tauri-apps/plugin-opener` | Apache-2.0 OR MIT |
| `cheerio`, `defuddle`, `fast-xml-parser`, `feedsmith`, `howler`, `motion`, `prismjs`, `react`, `react-dom`, `react-virtuoso`, `turndown` | MIT |
| `chroma-js` | BSD-3-Clause AND Apache-2.0 |
| `colorthief` | MIT |
| `dompurify` | Apache-2.0 |
| `jszip` | MIT |
| `linkedom` | ISC |
| `lite-youtube-embed` | Apache-2.0 |
| `pdfjs-dist` | Apache-2.0 |

## Rust (`src-tauri/Cargo.toml` dependencies)

| Crate | License |
| --- | --- |
| `tauri`, `tauri-plugin-opener`, `tauri-plugin-process` | Apache-2.0 OR MIT |
| `tokio`, `rusqlite`, `rfd`, `zip`, `sysinfo` | MIT |
| `serde`, `serde_json`, `chrono`, `reqwest`, `futures-util`, `once_cell`, `arboard`, `base64`, `uuid`, `image` | Apache-2.0 OR MIT |
| `html2md` | GPL-3.0-or-later |
| `objc2`, `objc2-foundation` | MIT |
| `objc2-app-kit` | Apache-2.0 OR MIT OR Zlib |

## Runtimes

System webview (WebKit / WebView2 / WebKitGTK). SQLite (public domain).
