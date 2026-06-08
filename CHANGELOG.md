# Changelog

## Unreleased

### Added

- GPL-3.0-or-later license (`LICENSE`, copyright Yomi Lab) and `THIRD_PARTY_NOTICES.md` (major npm/Rust deps and copyleft components).

### Fixed

- Feed-management drag-and-drop: disable Tauri `dragDropEnabled` on all windows so HTML5 DnD works; `tagsManager.updateTag` sends only provided fields so reorder no longer clears station emoji/color; drop-target highlight via per-cell box-shadow (avoids broken `tr` pseudo-elements in WebKit); drag handles use `span` instead of `button` for reliable HTML5 drag in Tauri.

### Changed

- `npm run build` runs `CI=true tauri build` (no Finder popup on macOS DMG bundling); frontend-only build moved to `build:web` for `beforeBuildCommand`.

### Added
- Tauri scheduler pause on station selection: ref-counted `pauseForStationSelection` / `resumeAfterStationSelection` in `feedSchedulerService`, wired from `handleTagSelection` to abort in-flight cycles and defer ticks until station selection completes; pause now starts at `handleTagSelection` entry (covers cached paint, animation, network, and list apply); overdue `catchUpAfterResume` sets `pendingCycleTick` while paused.
- Bootstrapped the KiJi Tauri migration workspace with the renamed app identity, a macOS GitHub Actions build, a typed `src/lib/tauriClient` entry point that centralizes renderer-to-Tauri command calls, and a committed command catalog that maps the Electron preload surface into planned Tauri domains.

### Changed
- Updated the macOS workflow artifact upload step to `actions/upload-artifact@v6` so the Tauri CI path stays on Node 24-native GitHub Actions runtimes.
