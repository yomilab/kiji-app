#!/usr/bin/env node
/**
 * Full local verification gate: verify + macOS real-app E2E + memory regressions.
 *
 * CI uses scripts/verify.mjs instead (no E2E / memory) to keep GitHub Actions fast.
 */
import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["scripts/verify.mjs"]);
run("npm", ["run", "test:memory"]);

if (process.platform === "darwin") {
  run("npm", ["run", "test:e2e"], {
    ...process.env,
    KIJI_E2E_REQUIRED: "1",
  });
} else {
  console.log("[verify:local] Skipping E2E on non-macOS (scheduler harness needs KiJi.app)");
}
