# Changelog

## Unreleased

### Added

- Cross-platform release-test monitor: `npm run release:test` dispatches `build-desktop.yml`, polls GitHub Actions, and retries failed runs up to 10 times (`scripts/monitor-release-test.mjs`).
- CI release matrix now includes Windows ARM64 and Linux ARM64 (deb/rpm cross-compile) alongside existing macOS/Windows/Linux x64 targets; `npm run test:ci` retries flaky Vitest cases in verify.

### Added

- GPL-3.0-or-later license (`LICENSE`, copyright Yomi Lab) and `THIRD_PARTY_NOTICES.md` (major npm/Rust deps and copyleft components).
- `src-tauri/Entitlements.plist` (WebKit hardened-runtime JIT flags) wired via `bundle.macOS.entitlements` for signed/notarized builds.
- Bundled Electron parity fixtures under `test/data` for CI smoke/parity coverage.

### Changed

- Add Feed modal: `.opml` URLs fetch and import feeds via the same OPML workflow as Import Feeds.
- GitHub Actions `build-desktop.yml` runs on `dev` pushes (integration/release-test); use `workflow_dispatch` on `main` for production verification. `npm run release:test` defaults to the `dev` branch.

### Fixed

- Interval feed refresh runs while KiJi is in the background: main window `backgroundThrottling: disabled`, native tick eval wake handler, resilient Rust interval loop, `ensureNativeDriverRunning` on catch-up, and WebLock fallback in scheduler lifecycle.
- Saved-article folder sync: append new `.md` files and merge into `articles.md` without overwriting existing on-disk articles or deleting extra files in `articles/`.
- GitHub Actions `build-desktop.yml` Linux ARM64: use native `ubuntu-24.04-arm` runner and shared Linux apt deps instead of x86_64 cross-compile, which hit Noble arm64 404s on `security.ubuntu.com` during `apt-get update`.
- GitHub Actions build: FeedContext tests mock `fetchFeedNetworkWithCache` (not legacy `fetchFeed`) and preserve `parseFeed` export; smoke tests use bundled fixtures; skip Vitest subprocess `cargo test` hooks in CI (workflow runs `cargo test` separately); `opmlWorkflowService` ignores undefined feed lookups after station selection.
- macOS CI artifacts: enable ad-hoc bundle signing (`signingIdentity: "-"`) so `.app`/`.dmg` seal resources and avoid Gatekeeper “damaged” errors; workflow verifies `codesign` and uploads DMG plus `KiJi-macos-aarch64.app.zip` (keeps `KiJi.app` bundle name).

### Fixed

- Feed-management drag-and-drop: disable Tauri `dragDropEnabled` on all windows so HTML5 DnD works; `tagsManager.updateTag` sends only provided fields so reorder no longer clears station emoji/color; drop-target highlight via per-cell box-shadow (avoids broken `tr` pseudo-elements in WebKit); drag handles use `span` instead of `button` for reliable HTML5 drag in Tauri.

### Changed

- Sidebar background refresh indicator shows **Syncing all** (no per-feed countdown) while scheduler or feed HTTP work is active.
- `npm run build` runs `CI=true tauri build` (no Finder popup on macOS DMG bundling); frontend-only build moved to `build:web` for `beforeBuildCommand`.

### Added
- Tauri scheduler pause on station selection: ref-counted `pauseForStationSelection` / `resumeAfterStationSelection` in `feedSchedulerService`, wired from `handleTagSelection` to abort in-flight cycles and defer ticks until station selection completes; pause now starts at `handleTagSelection` entry (covers cached paint, animation, network, and list apply); overdue `catchUpAfterResume` sets `pendingCycleTick` while paused.
- Bootstrapped the KiJi Tauri migration workspace with the renamed app identity, a macOS GitHub Actions build, a typed `src/lib/tauriClient` entry point that centralizes renderer-to-Tauri command calls, and a committed command catalog that maps the Electron preload surface into planned Tauri domains.

### Changed
- Updated the macOS workflow artifact upload step to `actions/upload-artifact@v6` so the Tauri CI path stays on Node 24-native GitHub Actions runtimes.
