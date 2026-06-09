#!/usr/bin/env node
/**
 * Dispatch the Tauri desktop release workflow, poll GitHub Actions, and retry on failure.
 *
 * Usage:
 *   node scripts/monitor-release-test.mjs
 *   node scripts/monitor-release-test.mjs --max-attempts 10 --profile release
 *   GITHUB_TOKEN=... node scripts/monitor-release-test.mjs --ref main
 *
 * Auth (first match wins):
 *   - GITHUB_TOKEN / GH_TOKEN env var
 *   - `gh auth token` when GitHub CLI is logged in
 *
 * Without a token, pass --trigger push to create an empty commit on the current branch.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULTS = {
  repo: "yomilab/kiji-app",
  workflowFile: "build-desktop.yml",
  ref: "main",
  profile: "release",
  maxAttempts: 10,
  pollSeconds: 30,
  trigger: "dispatch",
};

const BUILD_JOB_PREFIX = "Build release (";

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      options.repo = argv[++index];
      continue;
    }
    if (arg === "--ref") {
      options.ref = argv[++index];
      continue;
    }
    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }
    if (arg === "--max-attempts") {
      options.maxAttempts = Number(argv[++index]);
      continue;
    }
    if (arg === "--poll-seconds") {
      options.pollSeconds = Number(argv[++index]);
      continue;
    }
    if (arg === "--trigger") {
      options.trigger = argv[++index];
      continue;
    }
    if (arg === "--no-trigger") {
      options.trigger = "monitor";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error("--max-attempts must be a positive number");
  }
  return options;
}

function resolveToken() {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) {
    return fromEnv;
  }

  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (gh.status === 0) {
    const token = gh.stdout.trim();
    if (token) {
      return token;
    }
  }

  return null;
}

async function githubRequest(path, { method = "GET", token, body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload?.message
        ? payload.message
        : String(payload ?? response.statusText);
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${detail}`);
  }

  return payload;
}

async function dispatchWorkflow({ repo, ref, profile, token }) {
  await githubRequest(`/repos/${repo}/actions/workflows/${DEFAULTS.workflowFile}/dispatches`, {
    method: "POST",
    token,
    body: {
      ref,
      inputs: { profile },
    },
  });
}

function triggerPush(ref) {
  const message = `chore(ci): trigger release test on ${ref}`;
  const commit = spawnSync("git", ["commit", "--allow-empty", "-m", message], {
    stdio: "inherit",
  });
  if (commit.status !== 0) {
    throw new Error("Failed to create empty trigger commit");
  }
  const push = spawnSync("git", ["push", "origin", `HEAD:${ref}`], {
    stdio: "inherit",
  });
  if (push.status !== 0) {
    throw new Error(`Failed to push trigger commit to ${ref}`);
  }
}

async function waitForRun({ repo, ref, token, pollSeconds }) {
  const deadline = Date.now() + pollSeconds * 1000 * 4;
  while (Date.now() < deadline) {
    const payload = await githubRequest(
      `/repos/${repo}/actions/workflows/${DEFAULTS.workflowFile}/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=1`,
      { token },
    );
    const run = payload.workflow_runs?.[0];
    if (run) {
      return run;
    }
    await sleep(pollSeconds * 1000);
  }

  const fallback = await githubRequest(
    `/repos/${repo}/actions/workflows/${DEFAULTS.workflowFile}/runs?branch=${encodeURIComponent(ref)}&per_page=1`,
    { token },
  );
  const run = fallback.workflow_runs?.[0];
  if (!run) {
    throw new Error(`No workflow run found for ${repo}@${ref}`);
  }
  return run;
}

async function pollRun({ repo, runId, token, pollSeconds }) {
  while (true) {
    const run = await githubRequest(`/repos/${repo}/actions/runs/${runId}`, { token });
    if (run.status === "completed") {
      return run;
    }
    console.log(
      `[monitor-release-test] run ${runId} still ${run.status}; next check in ${pollSeconds}s`,
    );
    await sleep(pollSeconds * 1000);
  }
}

async function summarizeRun({ repo, runId, token }) {
  const jobsPayload = await githubRequest(`/repos/${repo}/actions/runs/${runId}/jobs`, {
    token,
  });
  const jobs = jobsPayload.jobs ?? [];
  const buildJobs = jobs.filter((job) => job.name?.startsWith(BUILD_JOB_PREFIX));
  const failedJobs = jobs.filter((job) => job.conclusion === "failure");
  const skippedBuildJobs = buildJobs.filter((job) => job.conclusion === "skipped");

  return {
    jobs,
    buildJobs,
    failedJobs,
    skippedBuildJobs,
    allBuildJobsSucceeded:
      buildJobs.length > 0 &&
      buildJobs.every((job) => job.conclusion === "success"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary({ attempt, run, summary }) {
  console.log("");
  console.log(`[monitor-release-test] attempt ${attempt}`);
  console.log(`  run: ${run.html_url}`);
  console.log(`  conclusion: ${run.conclusion}`);
  console.log(`  commit: ${run.head_sha?.slice(0, 8) ?? "unknown"}`);

  for (const job of summary.jobs) {
    const marker =
      job.conclusion === "success"
        ? "ok"
        : job.conclusion === "skipped"
          ? "skip"
          : "FAIL";
    console.log(`  [${marker}] ${job.name}`);
    if (job.conclusion === "failure") {
      for (const step of job.steps ?? []) {
        if (step.conclusion === "failure") {
          console.log(`        failed step: ${step.name}`);
        }
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = resolveToken();

  if (options.trigger === "dispatch" && !token) {
    console.warn(
      "[monitor-release-test] no GitHub token found; falling back to --trigger push",
    );
    options.trigger = "push";
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    console.log(
      `[monitor-release-test] starting attempt ${attempt}/${options.maxAttempts} (${options.trigger})`,
    );

    if (options.trigger === "monitor") {
      const payload = await githubRequest(
        `/repos/${options.repo}/actions/workflows/${DEFAULTS.workflowFile}/runs?branch=${encodeURIComponent(options.ref)}&per_page=1`,
        { token },
      );
      const started = payload.workflow_runs?.[0];
      if (!started) {
        throw new Error(`No workflow run found for ${options.repo}@${options.ref}`);
      }
      if (started.status !== "completed") {
        const completed = await pollRun({
          repo: options.repo,
          runId: started.id,
          token,
          pollSeconds: options.pollSeconds,
        });
        const summary = await summarizeRun({
          repo: options.repo,
          runId: completed.id,
          token,
        });
        printSummary({ attempt, run: completed, summary });
        if (completed.conclusion === "success" && summary.allBuildJobsSucceeded) {
          console.log("[monitor-release-test] all release build jobs succeeded");
          return;
        }
      } else {
        const summary = await summarizeRun({
          repo: options.repo,
          runId: started.id,
          token,
        });
        printSummary({ attempt, run: started, summary });
        if (started.conclusion === "success" && summary.allBuildJobsSucceeded) {
          console.log("[monitor-release-test] all release build jobs succeeded");
          return;
        }
      }
    } else if (options.trigger === "dispatch") {
      await dispatchWorkflow({
        repo: options.repo,
        ref: options.ref,
        profile: options.profile,
        token,
      });
      console.log("[monitor-release-test] workflow_dispatch sent");
      await sleep(5000);
      const started = await waitForRun({
        repo: options.repo,
        ref: options.ref,
        token,
        pollSeconds: options.pollSeconds,
      });
      const completed = await pollRun({
        repo: options.repo,
        runId: started.id,
        token,
        pollSeconds: options.pollSeconds,
      });
      const summary = await summarizeRun({
        repo: options.repo,
        runId: completed.id,
        token,
      });
      printSummary({ attempt, run: completed, summary });

      if (completed.conclusion === "success" && summary.allBuildJobsSucceeded) {
        console.log("[monitor-release-test] all release build jobs succeeded");
        return;
      }
    } else {
      triggerPush(options.ref);
      console.log("[monitor-release-test] pushed empty trigger commit");
      await sleep(10000);
      const payload = await githubRequest(
        `/repos/${options.repo}/actions/workflows/${DEFAULTS.workflowFile}/runs?branch=${encodeURIComponent(options.ref)}&per_page=1`,
        { token },
      );
      const started = payload.workflow_runs?.[0];
      if (!started) {
        throw new Error("Could not find workflow run after push trigger");
      }
      const completed = await pollRun({
        repo: options.repo,
        runId: started.id,
        token,
        pollSeconds: options.pollSeconds,
      });
      const summary = await summarizeRun({
        repo: options.repo,
        runId: completed.id,
        token,
      });
      printSummary({ attempt, run: completed, summary });

      if (completed.conclusion === "success" && summary.allBuildJobsSucceeded) {
        console.log("[monitor-release-test] all release build jobs succeeded");
        return;
      }
    }

    if (attempt < options.maxAttempts) {
      if (options.trigger === "monitor") {
        options.trigger = token ? "dispatch" : "push";
      }
      console.log(
        `[monitor-release-test] retrying after failure (next trigger: ${options.trigger})...`,
      );
      await sleep(options.pollSeconds * 1000);
    }
  }

  process.exitCode = 1;
  console.error(
    `[monitor-release-test] exhausted ${options.maxAttempts} attempts without a green release build`,
  );
}

main().catch((error) => {
  console.error(`[monitor-release-test] ${error.message}`);
  process.exit(1);
});
