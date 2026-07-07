/**
 * Shared KiJi real-app E2E helpers.
 *
 * macOS uses a file-based harness (not tauri-driver): Apple provides no WKWebView
 * WebDriver. Official tauri-driver supports Linux + Windows only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const E2E_SCHEDULER_INTERVAL_MS = "500";

export function getE2eSkipReason() {
  if (process.env.KIJI_SKIP_E2E === "1") {
    return "KIJI_SKIP_E2E=1";
  }

  if (process.env.CI === "true" && process.env.KIJI_RUN_E2E_IN_CI !== "1") {
    return "E2E disabled in CI (use verify:local or test:e2e on macOS)";
  }

  if (process.platform !== "darwin") {
    return "Scheduler E2E requires a macOS KiJi.app bundle (no WKWebView WebDriver)";
  }

  return null;
}

export function isE2eRequired() {
  return process.env.KIJI_E2E_REQUIRED === "1";
}

export function resolveE2eBundledBinary() {
  if (process.env.KIJI_E2E_BINARY && fs.existsSync(process.env.KIJI_E2E_BINARY)) {
    return process.env.KIJI_E2E_BINARY;
  }

  const candidates = [
    path.join(rootDir, "src-tauri/target/debug/bundle/macos/KiJi.app/Contents/MacOS/kiji-app"),
    path.join(
      rootDir,
      "src-tauri/target/aarch64-apple-darwin/debug/bundle/macos/KiJi.app/Contents/MacOS/kiji-app",
    ),
    path.join(
      rootDir,
      "src-tauri/target/x86_64-apple-darwin/debug/bundle/macos/KiJi.app/Contents/MacOS/kiji-app",
    ),
    path.join(rootDir, "src-tauri/target/release/bundle/macos/KiJi.app/Contents/MacOS/kiji-app"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function runNpmScript(scriptName, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", scriptName], {
      cwd: rootDir,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run ${scriptName} failed with code ${code ?? "unknown"}`));
    });
  });
}

export async function buildE2eDebugBundleIfNeeded() {
  const buildEnv = {
    VITE_KIJI_E2E: "1",
    VITE_KIJI_E2E_SCHEDULER_INTERVAL_MS: E2E_SCHEDULER_INTERVAL_MS,
  };

  await runNpmScript("build:web", buildEnv);
  await runNpmScript("build:debug", buildEnv);
  return resolveE2eBundledBinary();
}

export async function ensureE2eBundledBinary({ autoBuild = true } = {}) {
  const existing = resolveE2eBundledBinary();
  if (existing) {
    return existing;
  }

  if (!autoBuild || process.env.KIJI_E2E_AUTO_BUILD === "0") {
    return null;
  }

  if (process.env.CI === "true") {
    return null;
  }

  if (process.platform !== "darwin") {
    return null;
  }

  return buildE2eDebugBundleIfNeeded();
}

export function assertE2eNotSkipped(result) {
  if (!result.skipped) {
    return;
  }

  if (isE2eRequired()) {
    throw new Error(`E2E required but skipped: ${result.reason}`);
  }
}
