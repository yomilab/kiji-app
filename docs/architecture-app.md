# KiJi App Architecture

## Overview

KiJi App is the Tauri-based successor to the Electron app. The current repository keeps the generated React + TypeScript + Vite renderer and a Rust `src-tauri` shell while the migration moves desktop logic into explicit Tauri command domains.

## Runtime Layout

```text
src/
├── App.tsx
└── lib/tauriClient/
    ├── commandCatalog.ts
    ├── core.ts
    ├── dev.ts
    └── index.ts

src-tauri/
├── Cargo.toml
└── src/
    ├── lib.rs
    └── main.rs
```

- `src/App.tsx` is the renderer entry UI.
- `src/lib/tauriClient/commandCatalog.ts` inventories the current Electron preload surface and maps each method/event to its planned Tauri command namespace so migration work stays grouped by domain instead of recreating one-off IPC names.
- `src/lib/tauriClient/core.ts` owns the shared typed wrapper around `@tauri-apps/api/core` `invoke()`.
- `src/lib/tauriClient/index.ts` is the renderer-facing client root; new command groups should be exported from here instead of calling `invoke()` directly in components.
- `src/lib/tauriClient/dev.ts` is the first command domain and demonstrates the target pattern for future `feeds`, `articles`, `saved`, `settings`, and `system` domains.
- `src-tauri/src/main.rs` boots the native shell and delegates to the Rust library crate.

## Build and Verification Rules

- Every completed migration task must leave `npm run build` passing locally.
- Every completed migration task must leave `npm run tauri build` passing locally.
- Every completed migration task must also leave `.github/workflows/build-macos.yml` green on GitHub Actions.
- Tests can stay deferred during the active migration, but type safety and build health are mandatory after each finished todo.

## CI

- `.github/workflows/build-macos.yml` is the current baseline validation flow.
- The workflow is macOS-only for now, runs on `macos-14`, uses Node 24 plus stable Rust, runs `npx tsc --noEmit`, then runs `npm run tauri build`.
- Artifact upload uses `actions/upload-artifact@v6` so the workflow stays on the Node 24-native action line and avoids the GitHub-hosted Node 20 deprecation warning.
