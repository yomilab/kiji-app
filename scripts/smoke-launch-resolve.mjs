import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function targetDir(rustTarget, profile) {
  if (rustTarget) {
    return path.join(rootDir, "src-tauri/target", rustTarget, profile);
  }
  return path.join(rootDir, "src-tauri/target", profile);
}

function findLinuxAppImage(bundleDir) {
  const appImageDir = path.join(bundleDir, "appimage");
  if (!fs.existsSync(appImageDir)) {
    return null;
  }

  const match = fs
    .readdirSync(appImageDir)
    .find((name) => name.endsWith(".AppImage") || name.endsWith(".appimage"));
  return match ? path.join(appImageDir, match) : null;
}

export function resolveLaunchBinary({
  rustTarget = process.env.KIJI_RUST_TARGET,
  profile = process.env.KIJI_LAUNCH_PROFILE || "release",
  platformId = process.env.KIJI_PLATFORM_ID,
} = {}) {
  if (process.env.KIJI_APP_BINARY && fs.existsSync(process.env.KIJI_APP_BINARY)) {
    return process.env.KIJI_APP_BINARY;
  }

  const base = targetDir(rustTarget, profile);
  const bundleDir = path.join(base, "bundle");
  const resolvedPlatform = platformId ?? process.platform;

  if (resolvedPlatform.startsWith("macos") || process.platform === "darwin") {
    return firstExisting([
      path.join(bundleDir, "macos/KiJi.app/Contents/MacOS/kiji-app"),
      path.join(rootDir, "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/KiJi.app/Contents/MacOS/kiji-app"),
      path.join(rootDir, "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/KiJi.app/Contents/MacOS/kiji-app"),
      path.join(rootDir, "src-tauri/target/release/bundle/macos/KiJi.app/Contents/MacOS/kiji-app"),
      path.join(base, "kiji-app"),
    ]);
  }

  if (resolvedPlatform.startsWith("windows") || process.platform === "win32") {
    return firstExisting([
      path.join(base, "kiji-app.exe"),
      path.join(rootDir, "src-tauri/target/x86_64-pc-windows-msvc/release/kiji-app.exe"),
      path.join(rootDir, "src-tauri/target/aarch64-pc-windows-msvc/release/kiji-app.exe"),
    ]);
  }

  if (resolvedPlatform.startsWith("linux") || process.platform === "linux") {
    return firstExisting([
      findLinuxAppImage(bundleDir),
      path.join(base, "kiji-app"),
      path.join(rootDir, "src-tauri/target/x86_64-unknown-linux-gnu/release/kiji-app"),
      path.join(rootDir, "src-tauri/target/aarch64-unknown-linux-gnu/release/kiji-app"),
    ]);
  }

  return null;
}
