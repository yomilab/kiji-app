#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npx", ["tsc", "--noEmit"]);
run("npm", ["run", "test"]);
run("npm", ["run", "test:parity"]);
run("npm", ["run", "test:smoke"]);
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);
