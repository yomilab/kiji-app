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
]);

const INVOKE_PATTERNS = [
  /invoke(?:Contract(?:<[^>]*>)?|Command(?:<[^>]*>)?)\(\s*"([a-z0-9_]+)"/g,
  /invoke(?:<[^>]*>)?\(\s*['"]([a-z0-9_]+)['"]/g,
];

const STRUCT_ARGUMENT_EXPECTATIONS = [
  { command: "articles_query", argumentName: "request" },
  { command: "saved_query", argumentName: "request" },
  { command: "diagnostics_log_write_entry", argumentName: "entry" },
  { command: "shell_menu_update_state", argumentName: "patch" },
  { command: "shell_dialog_confirm", argumentName: "request" },
  { command: "shell_context_menu_show_image", argumentName: "request" },
  { command: "shell_file_write_text", argumentName: "request" },
  { command: "shell_share", argumentName: "request" },
  { command: "shell_share_to_service", argumentName: "request" },
  { command: "saved_sync_queue", argumentName: "request" },
] as const;

const DB_COMMAND_FILES = [
  "src-tauri/src/db/articles.rs",
  "src-tauri/src/db/saved.rs",
  "src-tauri/src/db/feeds.rs",
  "src-tauri/src/db/tags.rs",
] as const;

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

function readClientSource(): string {
  const sourceRoot = join(process.cwd(), "src");
  return collectSourceFiles(sourceRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("tauri command catalog", () => {
  it("maps invoke catalog entries to registered Rust commands", () => {
    const registered = readRegisteredRustCommands();
    const missing: string[] = [];

    for (const entries of Object.values(tauriCommandCatalog)) {
      for (const entry of entries) {
        if (entry.kind !== "invoke" || !entry.rustCommand) {
          continue;
        }

        if (!registered.has(entry.rustCommand)) {
          missing.push(`${entry.legacyMethod} -> ${entry.rustCommand}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("requires rustCommand on invoke catalog entries", () => {
    const missing: string[] = [];

    for (const entries of Object.values(tauriCommandCatalog)) {
      for (const entry of entries) {
        if (entry.kind === "invoke" && !entry.rustCommand) {
          missing.push(entry.legacyMethod);
        }
      }
    }

    expect(missing).toEqual([]);
  });

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

  it("wraps Rust struct-argument commands with the command parameter name", () => {
    const source = readClientSource();

    for (const { command, argumentName } of STRUCT_ARGUMENT_EXPECTATIONS) {
      const pattern = new RegExp(
        `[('"]${escapeRegExp(command)}[)'"][\\s\\S]{0,160}\\{\\s*${escapeRegExp(argumentName)}(?:\\s*:|\\s*[},])`,
      );
      expect(source, `${command} should pass { ${argumentName}: ... }`).toMatch(pattern);
    }
  });

  it("keeps saved_create request shape aligned with the Rust article argument", () => {
    const contracts = readFileSync(join(process.cwd(), "src/lib/tauriClient/contracts.ts"), "utf8");
    const savedClient = readFileSync(join(process.cwd(), "src/lib/tauriClient/saved.ts"), "utf8");
    const rustSaved = readFileSync(join(process.cwd(), "src-tauri/src/db/saved.rs"), "utf8");

    expect(contracts).toMatch(/interface SavedArticleCreateRequest[\s\S]*article:\s*SavedArticleRecord/);
    expect(savedClient).toContain('"saved_create"');
    expect(rustSaved).toMatch(/pub fn saved_create\(article: SavedArticleRecord/);
  });

  it("keeps DB command arguments camelCase-compatible with TypeScript clients", () => {
    for (const file of DB_COMMAND_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, `${file} has plain #[tauri::command] attributes`).not.toMatch(
        /#\[tauri::command\]\s*\npub fn /,
      );
    }
  });
});
