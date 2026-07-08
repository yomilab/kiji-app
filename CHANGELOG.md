# Changelog

## Unreleased

### Fixed

- E2E harness: keep command polling mounted via refs (no FeedContext-driven effect teardown), emit `harness-bootstrap-settled` after OPML bootstrap, wait for settle before feed-management/export commands, run delete via library API without opening feed edit, lengthen CI event timeouts, and serialize E2E vitest files with retries.

### Changed

- macOS CI release builds: import Developer ID certificate, notarize via App Store Connect API key, and verify `Developer ID Application` + stapler on `KiJi.app` (`build-desktop.yml`).

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
