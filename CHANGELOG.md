# Changelog

## Unreleased

### Added

- `website-sync-on-release.yml`: on GitHub Release publish, generate `release.json`, attach to the release, and dispatch `kiji-website` sync (`scripts/generate-release-manifest.mjs`).

### Fixed

- Cold-start freeze (~30s beach ball on a 2.5 GB library): `PRAGMA quick_check` no longer runs synchronously in the Tauri `setup()` hook on every launch. A `kiji.db.dirty` marker is written at open and removed after the exit WAL checkpoint; only when the marker survives (unclean shutdown) does the check run, 15s after startup on a background read-only connection, logging the outcome to diagnostics (`db/mod.rs`, `lib.rs`).
- Secondary windows (`settings`/`article`/`update`) recreated by macOS session restore no longer boot full renderers at launch (extra WebContent processes, 2.4 MB bundle parse each, and a spurious `shell_update_window_get_data` error every launch). `UserInitiatedWindowsState` records windows opened via app commands; an `on_page_load` hook destroys secondary webviews that load without an entry (`shell/window.rs`, `lib.rs`).
- Resource monitor false "threshold breach" errors: WebKit XPC helpers are launchd children, so system-wide totals also counted Safari/Mail/iOS-app processes (e.g. `processCount=39` at launch). `/System/iOSSupport/` WebKit processes are now excluded from classification, and breach alerts fire only on attributable metrics — native CPU, native memory, disk free (`diagnostics/snapshot.rs`, `diagnostics/resource_monitor.rs`).

### Changed

- `user-settings.json` is only rewritten at load when its normalized serialization differs from the on-disk content (was: unconditional write every launch) (`settings.rs`).
- "Clean Old Articles" now runs `PRAGMA wal_checkpoint(TRUNCATE); VACUUM;` on a background writer task after deleting rows so the database file actually shrinks; the deleted count still returns immediately (`db/articles.rs`).
- Removed the renderer's duplicate `shell_main_window_apply_saved_bounds` IPC on bootstrap (native `setup()` already applies saved bounds before the webview loads); dropped the now-unused command and `MainWindowBoundsSaveGuard` managed state (`renderer.tsx`, `shell/window.rs`).
- `ThemeProvider` loads settings once via `settingsManager.getSettings()` instead of three per-field getters (3 native IPC round-trips) at mount and on cross-window settings changes (`ThemeContext.tsx`).

## [1.0.1] - 2026-07-08

### Fixed

- E2E harness: keep command polling mounted via refs (no FeedContext-driven effect teardown), emit `harness-bootstrap-settled` after OPML bootstrap, wait for settle before feed-management/export commands, run delete via library API without opening feed edit, lengthen CI event timeouts, and serialize E2E vitest files with retries.

### Changed

- macOS CI release builds: Developer ID signing + notarization via App Store Connect API key; verify stapled `Developer ID Application` signatures on `KiJi.app` (`build-desktop.yml`).

## [1.0.0] - 2026-07-07

### Added

- Cross-platform release-test monitor: `npm run release:test` dispatches `build-desktop.yml`, polls GitHub Actions, and retries failed runs up to 10 times (`scripts/monitor-release-test.mjs`).
- CI release matrix now includes Windows ARM64 and Linux ARM64 (native ARM emulation via `pguyot/arm-runner-action`) alongside existing macOS/Windows/Linux x64 targets; `npm run test:ci` retries flaky Vitest cases in verify.

### Added

- GPL-3.0-or-later license (`LICENSE`, copyright Yomi Lab) and `THIRD_PARTY_NOTICES.md` (major npm/Rust deps and copyleft components).
- `src-tauri/Entitlements.plist` (WebKit hardened-runtime JIT flags) wired via `bundle.macOS.entitlements` for signed/notarized builds.
- Renamed renderer desktop API surface from `window.electronAPI` to `window.kijiAPI` (`kijiDesktopApi.ts`, `kijiDesktopApi.d.ts`); removed Electron-named parity fixtures and comments.
- User-interaction E2E harnesses: navigation, article deck, reader mode, OPML import/export, article-list scroll, feed-edit/delete, PDF (`userInteractions.e2e.test.ts`).

### Changed

- Test layout: split Vitest unit/e2e projects; CI parity + macOS `e2e-macos` job; cross-platform launch smoke in release build matrix; feed-refresh E2E; `verify:local` runs memory + required E2E.
- Add Feed modal: `.opml` URLs fetch and import feeds via the same OPML workflow as Import Feeds.
- GitHub Actions `build-desktop.yml` runs on `dev` pushes (integration/release-test); use `workflow_dispatch` on `main` for production verification. `npm run release:test` defaults to the `dev` branch.

### Fixed

- Scheduler wake E2E harness: `npm run test:e2e` spawns debug `KiJi.app`, mock feed server, and Rust `emit-system-resume` path; asserts catch-up imports post-wake articles in ~3s.
- macOS sleep/wake scheduler hooks: `scheduler:system-sleep` / `scheduler:system-resume` now emit to the main webview and eval-wake `__kijiSchedulerSleep` / `__kijiSchedulerResume` (same delivery as native cycle ticks) so overnight wake catch-up runs when the renderer was background-throttled.
- Station refresh now batch-syncs feed counts and patches the sidebar (same pattern as scheduler), after worker pool completes.
- Favicon discovery rejects blank placeholder icons (tiny monochrome ICO, near-empty/near-white rasters), expands WordPress `?w=` feed icons to larger sizes, and clears stored placeholders on retry (fixes TechCrunch blank sidebar icon).

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
- Bootstrapped the KiJi Tauri workspace with a macOS GitHub Actions build, a typed `src/lib/tauriClient` entry point, and a committed command catalog mapping renderer API methods to Tauri domains.

### Changed
- Updated the macOS workflow artifact upload step to `actions/upload-artifact@v6` so the Tauri CI path stays on Node 24-native GitHub Actions runtimes.
