import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const E2E_FEED_ID = "e2e-feed";
export const E2E_SCHEDULER_INTERVAL_MS = "500";
export const EVENT_TIMEOUT_MS = 45_000;
export const POLL_INTERVAL_MS = 200;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readEvent(e2eDir, name) {
  const eventPath = path.join(e2eDir, "events", `${name}.json`);
  if (!fs.existsSync(eventPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

export function getEventAtMs(event) {
  const at = event?.at;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

export function isEventAfter(event, afterAtMs) {
  const eventAt = getEventAtMs(event);
  return eventAt !== null && eventAt >= afterAtMs;
}

export function readEventIfBefore(e2eDir, name, beforeAtMs) {
  const event = readEvent(e2eDir, name);
  if (!event) {
    return null;
  }
  const eventAt = getEventAtMs(event);
  if (eventAt === null || eventAt >= beforeAtMs) {
    return null;
  }
  return event;
}

export function readEventIfAfter(e2eDir, name, afterAtMs) {
  const event = readEvent(e2eDir, name);
  if (!event || !isEventAfter(event, afterAtMs)) {
    return null;
  }
  return event;
}

export async function waitForPostImportEvent(
  e2eDir,
  name,
  postImportAtMs,
  predicate = () => true,
  timeoutMs = EVENT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readEvent(e2eDir, name);
    if (event && isEventAfter(event, postImportAtMs) && predicate(event)) {
      return event;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for post-import e2e event: ${name}`);
}

export async function waitForEvent(e2eDir, name, predicate = () => true, timeoutMs = EVENT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readEvent(e2eDir, name);
    if (event && predicate(event)) {
      return event;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for e2e event: ${name}`);
}

export function listSwitchPerfEvents(e2eDir) {
  const eventsDir = path.join(e2eDir, "events");
  if (!fs.existsSync(eventsDir)) {
    return [];
  }

  return fs.readdirSync(eventsDir)
    .filter((fileName) => fileName.startsWith("station-switch-perf-") && fileName.endsWith(".json"))
    .map((fileName) => JSON.parse(fs.readFileSync(path.join(eventsDir, fileName), "utf8")))
    .sort((left, right) => (getEventAtMs(left) ?? 0) - (getEventAtMs(right) ?? 0));
}

export async function waitForSwitchPerfEvent(e2eDir, afterAtMs, predicate = () => true, timeoutMs = EVENT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = listSwitchPerfEvents(e2eDir).filter((event) => isEventAfter(event, afterAtMs) && predicate(event));
    if (events.length > 0) {
      return events[events.length - 1];
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for station-switch-perf event");
}

export function terminateProcess(child) {
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

export function createE2eSessionDirs() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-home-"));
  const e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-dir-"));
  fs.mkdirSync(path.join(e2eDir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(e2eDir, "events"), { recursive: true });
  return { homeDir, e2eDir };
}

export function startE2eApp(binaryPath, { homeDir, e2eDir, feedUrl, extraEnv = {} }) {
  let stderr = "";
  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      HOME: homeDir,
      KIJI_E2E_DIR: e2eDir,
      KIJI_E2E_FEED_URL: feedUrl ?? "",
      KIJI_E2E_FEED_ID: E2E_FEED_ID,
      KIJI_E2E_SCHEDULER_INTERVAL_MS: E2E_SCHEDULER_INTERVAL_MS,
      KIJI_E2E_HIDE_UI: process.env.KIJI_E2E_HIDE_UI ?? "0",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return { child, stderr: () => stderr };
}

export async function stopE2eApp({ child, homeDir, e2eDir, mockFeed }) {
  await terminateProcess(child);
  if (mockFeed) {
    await mockFeed.stop();
  }
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(e2eDir, { recursive: true, force: true });
}

export function formatE2eFailure(error, e2eDir, getStderr) {
  const bootstrapError = readEvent(e2eDir, "scheduler-bootstrap-error");
  const details = bootstrapError
    ? ` bootstrapError=${JSON.stringify(bootstrapError.payload)}`
    : "";
  const eventsDir = path.join(e2eDir, "events");
  const eventNames = fs.existsSync(eventsDir)
    ? fs.readdirSync(eventsDir).map((fileName) => fileName.replace(/\.json$/, "")).sort()
    : [];
  const eventsSuffix = eventNames.length > 0 ? `\nevents: ${eventNames.join(", ")}` : "";
  const stderr = getStderr?.() ?? "";
  const suffix = stderr ? `\nstderr:\n${stderr}` : "";
  return `${error instanceof Error ? error.message : String(error)}${details}${eventsSuffix}${suffix}`;
}
