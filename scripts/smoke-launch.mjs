#!/usr/bin/env node
/**
 * Brief desktop launch smoke for KiJi (todo 22).
 *
 * Starts a built KiJi binary with an isolated HOME profile, verifies the process
 * stays alive briefly, then terminates it cleanly. Supports macOS, Windows, and Linux.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveLaunchBinary } from "./smoke-launch-resolve.mjs";

const LAUNCH_TIMEOUT_MS = 12_000;
const STABLE_RUNTIME_MS = 3_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateProcess(child) {
  if (child.killed || child.exitCode !== null) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    child.kill("SIGTERM");
  } else {
    child.kill("SIGTERM");
  }

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

function isolatedHomeDir() {
  if (process.platform === "win32") {
    return fs.mkdtempSync(path.join(os.tmpdir(), "kiji-smoke-home-"));
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiji-smoke-home-"));
}

function launchEnv(homeDir) {
  if (process.platform === "win32") {
    return {
      ...process.env,
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(homeDir, "AppData", "Local"),
    };
  }

  return {
    ...process.env,
    HOME: homeDir,
  };
}

export async function runLaunchSmoke() {
  if (process.env.KIJI_SKIP_LAUNCH_SMOKE === "1") {
    return { skipped: true, reason: "KIJI_SKIP_LAUNCH_SMOKE=1" };
  }

  const binaryPath = resolveLaunchBinary();
  if (!binaryPath) {
    return {
      skipped: true,
      reason: "No built KiJi binary found (run npm run build first)",
    };
  }

  const homeDir = isolatedHomeDir();
  const child = spawn(binaryPath, [], {
    env: launchEnv(homeDir),
    stdio: "ignore",
    detached: process.platform !== "win32",
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
      platform: process.platform,
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
        `[smoke-launch] Passed: ${result.binaryPath} stayed alive for ${STABLE_RUNTIME_MS}ms (${result.platform})`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[smoke-launch] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
