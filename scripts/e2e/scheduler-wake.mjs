#!/usr/bin/env node
/**
 * End-to-end scheduler wake harness.
 *
 * Spawns a real KiJi debug bundle with an isolated HOME, serves a mock Atom feed,
 * waits for the first scheduler cycle, triggers the Rust system-resume emit path,
 * and asserts a second catch-up cycle inserts the post-wake article.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import { createMockFeedServer } from "./mockFeedServer.mjs";

const EVENT_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 200;
const E2E_FEED_ID = "e2e-feed";
const E2E_SCHEDULER_INTERVAL_MS = "500";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEvent(e2eDir, name) {
  const eventPath = path.join(e2eDir, "events", `${name}.json`);
  if (!fs.existsSync(eventPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

async function waitForEvent(e2eDir, name, predicate = () => true) {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = readEvent(e2eDir, name);
    if (event && predicate(event)) {
      return event;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for e2e event: ${name}`);
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

export async function runSchedulerWakeE2e() {
  const skipReason = getE2eSkipReason();
  if (skipReason) {
    return { skipped: true, reason: skipReason };
  }

  const binaryPath = await ensureE2eBundledBinary();
  if (!binaryPath) {
    const reason = isE2eRequired()
      ? "KiJi.app debug bundle missing — run npm run build:debug"
      : "No KiJi debug bundle available";
    return { skipped: true, reason };
  }

  const mockFeed = createMockFeedServer();
  const { feedUrl } = await mockFeed.start();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-home-"));
  const e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-dir-"));
  fs.mkdirSync(path.join(e2eDir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(e2eDir, "events"), { recursive: true });

  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      HOME: homeDir,
      KIJI_E2E_DIR: e2eDir,
      KIJI_E2E_FEED_URL: feedUrl,
      KIJI_E2E_FEED_ID: E2E_FEED_ID,
      KIJI_E2E_SCHEDULER_INTERVAL_MS: E2E_SCHEDULER_INTERVAL_MS,
      KIJI_E2E_HIDE_UI: process.env.KIJI_E2E_HIDE_UI ?? "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const readyEvent = await waitForEvent(
      e2eDir,
      "scheduler-ready",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    const initialArticleCount = readyEvent.payload?.articleCount ?? 0;
    if (initialArticleCount < 1) {
      throw new Error(`Expected at least one article after first cycle, got ${initialArticleCount}`);
    }

    await sleep(Number(E2E_SCHEDULER_INTERVAL_MS) + 200);

    fs.writeFileSync(path.join(e2eDir, "commands", "emit-system-resume"), "");
    await waitForEvent(e2eDir, "resume-emitted");

    const catchUpEvent = await waitForEvent(
      e2eDir,
      "cycle-complete",
      (event) => (event.payload?.cycleCount ?? 0) >= 2,
    );

    const articleCountAfterWake = catchUpEvent.payload?.articleCount ?? 0;
    if (articleCountAfterWake < 2) {
      throw new Error(
        `Expected post-wake article import (>=2 articles), got ${articleCountAfterWake}`,
      );
    }

    return {
      skipped: false,
      binaryPath,
      feedUrl,
      initialArticleCount,
      articleCountAfterWake,
      cycleCount: catchUpEvent.payload?.cycleCount ?? 0,
    };
  } catch (error) {
    const bootstrapError = readEvent(e2eDir, "scheduler-bootstrap-error");
    const details = bootstrapError
      ? ` bootstrapError=${JSON.stringify(bootstrapError.payload)}`
      : "";
    const suffix = stderr ? `\nstderr:\n${stderr}` : "";
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${details}${suffix}`,
    );
  } finally {
    await terminateProcess(child);
    await mockFeed.stop();
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(e2eDir, { recursive: true, force: true });
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runSchedulerWakeE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:scheduler-wake] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:scheduler-wake] Passed: cycles=${result.cycleCount} articles=${result.articleCountAfterWake}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:scheduler-wake] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
