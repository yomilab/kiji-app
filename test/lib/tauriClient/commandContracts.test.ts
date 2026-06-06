import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tauriCommandCatalog } from "@/lib/tauriClient/commandCatalog";

const CLIENT_INVOKE_ALLOWLIST = new Set([
  // Helper tasks run in the renderer queue during the Tauri migration.
  "tasks_helper_add",
  "tasks_helper_remove",
  "tasks_helper_clear",
  "tasks_helper_get_queue_snapshot",
  // Article window payload still uses renderer-local storage until a native bridge lands.
  "shell_article_window_open",
]);

const INVOKE_PATTERNS = [
  /invoke(?:Contract(?:<[^>]*>)?|Command(?:<[^>]*>)?)\(\s*"([a-z0-9_]+)"/g,
  /invoke(?:<[^>]*>)?\(\s*['"]([a-z0-9_]+)['"]/g,
];

function readRegisteredRustCommands(): Set<string> {
  const libRs = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  const handlerBlock = libRs.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return new Set(
    [...handlerBlock.matchAll(/^\s+([a-z0-9_]+),?\s*$/gm)].map((match) => match[1]),
  );
}

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function readClientInvokeCommands(): Set<string> {
  const sourceRoot = join(process.cwd(), "src");
  const commands = new Set<string>();

  for (const file of collectSourceFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of INVOKE_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        commands.add(match[1]);
      }
    }
  }

  return commands;
}

describe("tauri command catalog", () => {
  it("keeps legacy method and channel identifiers unique", () => {
    const legacyMethods = new Set<string>();
    const legacyChannels = new Set<string>();

    for (const entries of Object.values(tauriCommandCatalog)) {
      for (const entry of entries) {
        expect(legacyMethods.has(entry.legacyMethod)).toBe(false);
        expect(legacyChannels.has(entry.legacyChannel)).toBe(false);
        legacyMethods.add(entry.legacyMethod);
        legacyChannels.add(entry.legacyChannel);
      }
    }
  });

  it("registers every client invoke command in Rust except explicit allowlist entries", () => {
    const registered = readRegisteredRustCommands();
    const clientCommands = readClientInvokeCommands();
    const missing = [...clientCommands]
      .filter((command) => !registered.has(command) && !CLIENT_INVOKE_ALLOWLIST.has(command))
      .sort();

    expect(missing).toEqual([]);
  });

  it("does not leave stale Rust commands without a typed client wrapper", () => {
    const clientCommands = readClientInvokeCommands();
    const registered = readRegisteredRustCommands();
    const unmapped = [...registered]
      .filter((command) => !clientCommands.has(command))
      .sort();

    expect(unmapped).toEqual([]);
  });
});
