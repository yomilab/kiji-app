# Changelog

## Unreleased

### Added
- Bootstrapped the KiJi Tauri migration workspace with the renamed app identity, a macOS GitHub Actions build, a typed `src/lib/tauriClient` entry point that centralizes renderer-to-Tauri command calls, and a committed command catalog that maps the Electron preload surface into planned Tauri domains.

### Changed
- Updated the macOS workflow artifact upload step to `actions/upload-artifact@v6` so the Tauri CI path stays on Node 24-native GitHub Actions runtimes.
