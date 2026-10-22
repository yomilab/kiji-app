# Changelog

## Unreleased

### Fixed

- Importing a feed list that KiJi exported no longer puts feeds that weren't in a station into a new station named after the file (such as "Feeds").

## [1.7.0] - 2026-10-19

### Added

- New **Assistant** tab in Settings lets AI apps such as Claude, Cursor, VS Code and Codex read your KiJi library — including the article you're reading right now — so you can ask them to explain an article, summarize a station's week, or search your feeds. It's off until you turn it on, read-only, and you choose which stations, saved articles and notes are shared. One click adds KiJi to Claude Desktop, Cursor or VS Code.
- You can also let assistants make changes for you: mark articles read or unread, star them, or save them to Saved when you ask. This has its own switch in Settings → Assistant, is off until you turn it on, and the article list, unread counts and Saved update right away.
- New **Manage Feeds** window keeps your feeds, stations, Library views, and import and export in one place, with tabs along the top like a Mac settings window. Lists show each feed's icon, site, counts and status, and you can select several feeds to change them together.

### Changed

- Adding a feed is simpler: paste a link and KiJi shows the feed — its title, site and latest articles — before you add it, or tells you if you already follow it. Importing a feed list or saved articles has its own tab.
- Settings has a cleaner, more Mac-like look, with a slimmer sidebar and new icons.

### Fixed

- On Windows and Linux, the close button of the full-window image viewer no longer sits under the window's own Close button, so closing an image no longer closes the window.

## [1.6.0] - 2026-10-18

### Added

- Articles give pictures more room: single images and videos can spread wider than the text, rows of images become galleries, wide tables and code can use the margins, and clicking an image opens it full-window.
- The top of an article shows when it was published and how long it takes to read, and a thin bar shows your progress as you read.

### Changed

- In light mode, the selected item in the sidebar is easier to read, and feed icons in the article list sit on a light background.
- The About and update window lists what's new in an update, grouped into New, Improved and Fixed, so you can read the notes before downloading. It has a cleaner layout, uses your reader theme's accent color, and its buttons match your system's style.

### Fixed

- A feed that fails to refresh while you open its station no longer waits twice as long before KiJi tries it again.
- Rare database or connection hiccups while switching stations, opening smart views, syncing in the background or leaving a search no longer leave errors in the log; the list retries on your next scroll or interaction.
- Opening a station no longer re-reads every feed in it just to look for missing icons.
- Adding a feed no longer reports a failure when the feed was added but its first articles or icon could not be saved; KiJi opens the new feed and loads its articles.
- Switching stations while feeds sync in the background no longer marks healthy feeds as failing, so they keep refreshing on schedule.
- A feed that has been failing for a long time no longer starts being retried on every refresh.
- Removing a feed while a refresh is running no longer stops the rest of the library from refreshing.
- Feeds whose items have no link or ID no longer show the same article again after every refresh.
- Changing a theme, font or other setting no longer interrupts or restarts background refresh.
- Importing an OPML file while a saved-articles import is running no longer leaves that import stuck.
- Large OPML imports are faster, and a problem assigning one station no longer reports the whole import as failed.
- Importing a saved-articles ZIP now keeps the right text for articles that share a title, such as "Untitled".
- Holding j or k while opening an article or a dialog no longer keeps moving through the list behind it.
- Saving an article and quickly opening another no longer shows the first article in the new view.
- Clearing all feeds or deleting a station with its feeds now updates the sidebar even if part of the cleanup fails.
- Choosing a feed or station while KiJi's window is behind other windows (or when KiJi reopens your last selection in the background) now refreshes it right away, instead of pausing background updates for up to 10 minutes.
- Feed icons in the sidebar show again after launch, without slowing down startup.
- Feeds in Japanese, Chinese and other non-UTF-8 encodings now load instead of failing every time.
- Background refresh no longer makes marking articles read or starred wait while large feeds are processed, and a failed save of a feed's new articles no longer leaves it half-updated.
- Unread counts are now correct for each feed when two subscriptions share the same articles.
- Clicking a station during a background refresh no longer delays refreshing the rest of your library.
- Importing the same saved-articles file twice no longer creates duplicates; KiJi tells you how many were already saved. CSV files with quotes or commas in titles import correctly.

## [1.5.0] - 2026-10-16

### Changed

- New app icon, Ripple: waves spreading out from a corner. Choose Ripple, Ripple Dark, Light or Dark in Settings → App icon. If you had picked Sunset, Cosmos, Particle or Wave, KiJi now shows Ripple, because those icons were retired.

### Fixed

- Security update for a built-in networking library.

## [1.4.0] - 2026-10-16

### Added

- Reader themes: 13 book-inspired looks for reading, including Paper, Sepia, Calm, Washi, Newsprint, E-Ink, Solarized, Midnight and High Contrast, each in a light and a dark version. Pick one in Settings → Appearance → Theme → Reader theme.

### Changed

- KiJi now uses its full name, KiJi Reader, in About, update messages and feedback emails, and the app menu is called Reader.

### Fixed

- Security updates for several built-in libraries.

## [1.3.0] - 2026-09-24

### Added

- A Read view in the library, so you can find articles you have already read.
- You can drag the window by more of the header area.
- The sync status at the bottom of the sidebar now says what is syncing: your whole library, one feed or a station.
- Windows and Linux: a KiJi menu in the app's menu bar.

### Changed

- Station names appear right away instead of waiting for feed icons, and the sidebar loads faster.

### Fixed

- KiJi no longer uses more and more memory when left running with background refresh, including after your Mac wakes from sleep.
- Searching your articles stays accurate while feeds sync.
- The loading placeholder in the article list now fits tall windows.
- Station lists show new articles after a background refresh instead of an outdated list.
- Dragging feeds and stations to reorder them in the sidebar sorts correctly, and large imports are faster.

## [1.2.0] - 2026-09-08

A reliability release with fixes for Windows, the article list, the sidebar and startup.

### Added

- Surface opacity: a slider in Settings → Appearance sets how see-through the sidebar is.
- A new Wave app icon in Settings → App icon.

### Changed

- The default app icon is now Light instead of Cosmos. You can still pick the others in Settings.
- Clean Old Articles now frees disk space by shrinking the database file.
- KiJi does a little less work at launch and when you change settings.

### Fixed

- Large libraries no longer freeze KiJi for up to 30 seconds at launch.
- Windows 10: File → Settings…, the sidebar gear and Ctrl+, open Settings again.
- Switching to a station or feed no longer gets stuck at 100 items with Load more not working.
- After importing an OPML file, KiJi shows the new feeds' articles as soon as they arrive instead of sometimes showing an empty list.
- Articles fetched in the background while you switch stations now show up right away instead of after your next switch.
- Sidebar: folded sections stay folded, long titles are shortened neatly, drag-to-sort works, and the refresh icon spins in place.
- Feed management no longer shows dark bands behind its headers in the Modern theme.
- macOS no longer reopens hidden Settings, article or update windows at launch, which used extra memory.
- KiJi no longer shows false resource warnings caused by other apps.
- Security updates for several built-in libraries.

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
