#!/usr/bin/env node
/**
 * Print which Vitest configs include which test files (audit helper).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listFiles(dir, pattern) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, pattern));
      continue;
    }
    if (pattern.test(entry.name)) {
      results.push(path.relative(rootDir, fullPath));
    }
  }
  return results.sort();
}

function vitestList(configPath) {
  const result = spawnSync(
    "npx",
    ["vitest", "list", "--config", configPath],
    { cwd: rootDir, encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { error: result.stderr || result.stdout };
  }

  const files = new Set();
  const tests = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    tests.push(trimmed);
    const match = trimmed.match(/\] (test\/[^\s>]+\.(?:test|e2e\.test)\.tsx?)/);
    if (match) {
      files.add(match[1]);
    }
  }

  return { files: [...files].sort(), tests };
}

const unitOnDisk = listFiles(path.join(rootDir, "test"), /\.test\.tsx?$/).filter(
  (file) => !file.endsWith(".e2e.test.ts"),
);
const e2eOnDisk = listFiles(path.join(rootDir, "test/e2e"), /\.e2e\.test\.ts$/);

const unitListed = vitestList("vitest.config.ts");
const e2eListed = vitestList("vitest.e2e.config.ts");

console.log("=== KiJi test include audit ===\n");
console.log(`Unit files on disk (excl. e2e): ${unitOnDisk.length}`);
console.log(`E2E files on disk: ${e2eOnDisk.length}`);
console.log("");

if (unitListed.error) {
  console.log("Unit vitest list failed:", unitListed.error);
} else {
  console.log(`Unit files in vitest.config.ts: ${unitListed.files.length} (${unitListed.tests.length} cases)`);
  const unitSet = new Set(unitListed.files);
  const missingFromUnit = unitOnDisk.filter((f) => !unitSet.has(f));
  const extraInUnit = [...unitSet].filter((f) => !unitOnDisk.includes(f));
  if (missingFromUnit.length) {
    console.log("  NOT in unit config:", missingFromUnit.join(", "));
  }
  if (extraInUnit.length) {
    console.log("  Extra in unit config:", extraInUnit.join(", "));
  }
  if (!missingFromUnit.length && !extraInUnit.length) {
    console.log("  OK — unit config matches disk");
  }
}

console.log("");

if (e2eListed.error) {
  console.log("E2E vitest list failed:", e2eListed.error);
} else {
  console.log(`E2E files in vitest.e2e.config.ts: ${e2eListed.files.length} (${e2eListed.tests.length} cases)`);
  for (const file of e2eListed.files) {
    console.log(`  - ${file}`);
  }
}

console.log("\n=== Gate scripts ===");
console.log("verify.mjs:        tsc, test (unit), test:parity, test:smoke, cargo test");
console.log("verify:local.mjs:  verify + test:memory + test:e2e (macOS, required)");
console.log("CI verify:         tsc, test:ci, test:parity, cargo test, test:smoke");
console.log("CI e2e-macos:      build:debug + test:e2e (parallel with release build matrix)");
