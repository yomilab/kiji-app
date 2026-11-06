#!/usr/bin/env node
/**
 * Unreleased notes live in `changes/`, one file per PR, so PRs never edit the
 * same lines of CHANGELOG.md. On release this gathers them into
 * `## [x.y.z] - date` (Added / Changed / Fixed) and deletes them. See changes/README.md.
 *
 * Usage:
 *   node scripts/release-changes.mjs --preview                    # print the draft, change nothing
 *   node scripts/release-changes.mjs --version 2.1.0              # write CHANGELOG.md, delete fragments
 *   node scripts/release-changes.mjs --version 2.1.0 --date 2026-11-13
 *
 * Lines still under `## Unreleased` (a PR from before fragments) are included too,
 * and `## Unreleased` is left empty. Exits non-zero on a malformed fragment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECTION_TITLES, findVersionSection, parseSectionLines } from "./release-notes.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Fragment `type:` values → CHANGELOG headings. */
export const CHANGE_TYPES = { added: "Added", changed: "Changed", fixed: "Fixed" };

const README_NAME = "readme.md";

/**
 * One fragment: a `type:` front-matter line and a one-line note.
 * @returns {{ heading: string, note: string }}
 */
export function parseChangeFragment(text, fileName = "fragment") {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let index = 0;
  let type = null;
  const fenced = lines[0]?.trim() === "---";
  if (fenced) {
    index = 1;
    for (; index < lines.length && lines[index].trim() !== "---"; index += 1) {
      const match = /^type:\s*(\S+)\s*$/i.exec(lines[index].trim());
      if (match) type = match[1].toLowerCase();
    }
    if (index >= lines.length) {
      throw new Error(`changes/${fileName}: the front matter has no closing "---".`);
    }
    index += 1;
  } else {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const match = /^type:\s*(\S+)\s*$/i.exec(lines[index]?.trim() ?? "");
    if (match) {
      type = match[1].toLowerCase();
      index += 1;
    }
  }

  if (!type) {
    throw new Error(`changes/${fileName}: missing "type: added|changed|fixed".`);
  }
  const heading = CHANGE_TYPES[type];
  if (!heading) {
    throw new Error(`changes/${fileName}: unknown type "${type}" (use added, changed or fixed).`);
  }
  const note = lines
    .slice(index)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^[-*]\s+/, "");
  if (!note) {
    throw new Error(`changes/${fileName}: the note is empty.`);
  }
  return { heading, note };
}

/** Every fragment in `changesDir`, by file name. README.md and non-Markdown files are skipped. */
export function collectChangeFragments(changesDir) {
  if (!fs.existsSync(changesDir)) {
    return [];
  }
  return fs.readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name.toLowerCase() !== README_NAME)
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({ file, ...parseChangeFragment(fs.readFileSync(path.join(changesDir, file), "utf8"), file) }));
}

/** Bullets still under `## Unreleased`, as `{ heading, note }` like fragments. */
export function unreleasedChanges(changelog) {
  const { summaryLines, groups } = parseSectionLines(findVersionSection(changelog, "Unreleased") ?? []);
  if (summaryLines.length) {
    throw new Error('CHANGELOG.md has text under "## Unreleased" outside a "###" group; move it into changes/.');
  }
  return [...groups].flatMap(([heading, items]) => items.map((note) => ({ heading, note })));
}

/** Changes grouped by heading, in Added / Changed / Fixed order; empty groups dropped. */
export function groupChanges(changes) {
  const knownOrder = SECTION_TITLES.map(([heading]) => heading);
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const { heading, note } of changes) {
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(note);
  }
  const rank = (heading) => (knownOrder.includes(heading) ? knownOrder.indexOf(heading) : knownOrder.length);
  return [...groups.keys()]
    .sort((left, right) => rank(left) - rank(right))
    .map((heading) => ({ heading, items: groups.get(heading) }));
}

export function renderVersionSection(version, date, groups) {
  const lines = [`## [${version}] - ${date}`];
  for (const group of groups) {
    lines.push("", `### ${group.heading}`, "");
    for (const item of group.items) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** CHANGELOG.md with `section` right below an emptied `## Unreleased`. */
export function insertVersionSection(changelog, section) {
  const lines = changelog.split(/\r?\n/);
  const isUnreleased = (line) => /^##\s+\[?Unreleased\]?\s*$/i.test(line);
  let start = lines.findIndex(isUnreleased);
  let end;
  if (start === -1) {
    // No Unreleased heading yet: add one above the newest version.
    start = lines.findIndex((line) => /^##\s/.test(line));
    if (start === -1) start = lines.length;
    end = start;
  } else {
    end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
    if (end === -1) end = lines.length;
  }
  const head = lines.slice(0, start);
  while (head.length && !head[head.length - 1].trim()) head.pop();
  const tail = lines.slice(end);
  while (tail.length && !tail[tail.length - 1].trim()) tail.pop();
  const parts = [...head, "", "## Unreleased", "", section.trimEnd()];
  if (tail.length) parts.push("", ...tail);
  return `${parts.join("\n").replace(/^\n+/, "")}\n`;
}

/** Next version from the current one: minor when anything was added, else patch. */
export function suggestVersion(currentVersion, groups) {
  const [major, minor, patch] = String(currentVersion).replace(/^v/i, "").split(".").map(Number);
  if ([major, minor, patch].some((part) => !Number.isInteger(part))) {
    return null;
  }
  return groups.some((group) => group.heading === "Added")
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}

/**
 * Builds the release section from `changes/` plus any leftover `## Unreleased`
 * lines. With `write`, updates CHANGELOG.md and deletes the fragments.
 * @returns {{ section: string | null, groups: { heading: string, items: string[] }[], fragments: string[], leftovers: number }}
 */
export function releaseChanges({ rootDir = ROOT_DIR, version, date, write = false }) {
  const changelogPath = path.join(rootDir, "CHANGELOG.md");
  const changesDir = path.join(rootDir, "changes");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  if (write && findVersionSection(changelog, version)) {
    throw new Error(`CHANGELOG.md already has a "## [${version}]" section.`);
  }

  const fragments = collectChangeFragments(changesDir);
  const leftovers = unreleasedChanges(changelog);
  const groups = groupChanges([...leftovers, ...fragments]);
  const result = { groups, fragments: fragments.map(({ file }) => file), leftovers: leftovers.length };
  if (groups.length === 0) {
    return { ...result, section: null };
  }

  const section = renderVersionSection(version, date, groups);
  if (write) {
    fs.writeFileSync(changelogPath, insertVersionSection(changelog, section), "utf8");
    for (const { file } of fragments) {
      fs.rmSync(path.join(changesDir, file));
    }
  }
  return { ...result, section };
}

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function runCli() {
  const flags = new Set();
  const args = new Map();
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args.set(argv[index].slice(2), value);
      index += 1;
    } else {
      flags.add(argv[index].slice(2));
    }
  }

  const preview = flags.has("preview");
  const date = args.get("date") ?? localDate();
  let version = (args.get("version") ?? "").replace(/^v/i, "");
  if (!preview && !version) {
    console.error("Missing --version (e.g. 2.1.0), or pass --preview to only print the draft.");
    process.exit(1);
  }
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`--version must look like 2.1.0, got "${version}".`);
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date must look like 2026-11-13, got "${date}".`);
    process.exit(1);
  }

  try {
    const suggested = preview && !version;
    if (suggested) {
      const { groups } = releaseChanges({ version: "x.y.z", date });
      const current = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")).version;
      version = suggestVersion(current, groups) ?? "x.y.z";
    }
    const { section, fragments, leftovers } = releaseChanges({ version, date, write: !preview });
    if (!section) {
      console.error("No changes waiting: changes/ has no notes and ## Unreleased is empty.");
      process.exit(preview ? 0 : 1);
    }
    process.stdout.write(section);
    const sources = `${fragments.length} file(s) in changes/${leftovers ? ` and ${leftovers} line(s) from ## Unreleased` : ""}`;
    console.error(preview
      ? `\nDraft only, nothing written. From ${sources}.${suggested ? ` ${version} is suggested: minor when something was added, else patch.` : ""}`
      : `\nWrote ## [${version}] to CHANGELOG.md from ${sources}; deleted those files.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
