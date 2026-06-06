#!/usr/bin/env node
/**
 * Brief macOS launch smoke for KiJi (todo 22).
 *
 * Starts a built KiJi binary with an isolated HOME profile, verifies the process
 * stays alive briefly, then terminates it cleanly.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCH_TIMEOUT_MS = 12_000;
const STABLE_RUNTIME_MS = 3_000;

function resolveAppBinary() {
  const candidates = [
    path.join(
      rootDir,
      "src-tauri/target/release/bundle/macos/KiJi.app/Contents/MacOS/kiji-app",
    ),
    path.join(rootDir, "src-tauri/target/debug/kiji-app"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateProcess(child) {
  if (child.killed || child.exitCode !== null) {
    return Promise.resolve();
  }

  child.kill("SIGTERM");

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 4_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runLaunchSmoke() {
  if (process.platform !== "darwin") {
    return { skipped: true, reason: "macOS only" };
  }

  if (process.env.KIJI_SKIP_LAUNCH_SMOKE === "1") {
    return { skipped: true, reason: "KIJI_SKIP_LAUNCH_SMOKE=1" };
  }

  const binaryPath = resolveAppBinary();
  if (!binaryPath) {
    return {
      skipped: true,
      reason: "No built KiJi binary found (run npm run build:tauri first)",
    };
  }

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-smoke-home-"));
  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: "ignore",
  });

  let exitedEarly = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exitedEarly = true;
    exitCode = code;
  });

  try {
    await sleep(STABLE_RUNTIME_MS);

    if (exitedEarly) {
      throw new Error(
        `KiJi exited early during launch smoke (code ${exitCode ?? "unknown"})`,
      );
    }

    await Promise.race([
      sleep(LAUNCH_TIMEOUT_MS - STABLE_RUNTIME_MS),
      new Promise((_, reject) => {
        child.once("exit", (code) => {
          reject(
            new Error(
              `KiJi exited unexpectedly during launch smoke (code ${code ?? "unknown"})`,
            ),
          );
        });
      }),
    ]);

    return {
      skipped: false,
      binaryPath,
      homeDir,
      pid: child.pid,
    };
  } finally {
    await terminateProcess(child);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runLaunchSmoke()
    .then((result) => {
      if (result.skipped) {
        console.log(`[smoke-launch] Skipped: ${result.reason}`);
        process.exit(0);
      }

      console.log(
        `[smoke-launch] Passed: ${result.binaryPath} stayed alive for ${STABLE_RUNTIME_MS}ms`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[smoke-launch] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
