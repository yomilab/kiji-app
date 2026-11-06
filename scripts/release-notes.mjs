#!/usr/bin/env node
/**
 * Release notes from CHANGELOG.md — the one source for the update window
 * (release.json `notes`), the GitHub release body, and the website changelog.
 *
 * Usage:
 *   node scripts/release-notes.mjs --version 1.6.0                 # Markdown (GitHub body)
 *   node scripts/release-notes.mjs --version 1.6.0 --format json   # release.json `notes`
 *   node scripts/release-notes.mjs --version 1.6.0 --output notes.md
 *
 * Exits non-zero when CHANGELOG.md has no `## [<version>]` section or it is empty,
 * so a release cannot ship without confirmed notes. Unreleased notes live in
 * `changes/`; `scripts/release-changes.mjs` writes them into that section.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** CHANGELOG headings → user-facing group titles, in display order. */
export const SECTION_TITLES = [
  ["Added", "New"],
  ["Changed", "Improved"],
  ["Fixed", "Fixed"],
  ["Security", "Security"],
  ["Removed", "Removed"],
  ["Deprecated", "Deprecated"],
];

/**
 * Translated changelogs (`CHANGELOG.<locale>.md`), written by the agent after the
 * English section is confirmed. Same versions and English `###` headings.
 */
export const TRANSLATION_LOCALES = ["zh-Hans", "ja"];

const LOCALIZED_SECTION_TITLES = {
  "zh-Hans": { Added: "新功能", Changed: "改进", Fixed: "修复", Security: "安全", Removed: "移除", Deprecated: "弃用" },
  ja: { Added: "新機能", Changed: "改善", Fixed: "修正", Security: "セキュリティ", Removed: "削除", Deprecated: "非推奨" },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain text for app/website rendering: drop Markdown emphasis, code ticks, and links. */
export function toPlainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Raw Markdown lines of one `## [version]` section, or null. */
export function findVersionSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const normalized = String(version).trim().replace(/^v/i, "");
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRegExp(normalized)}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

/**
 * Intro lines and `###` groups of one section; bullets keep their Markdown and
 * wrapped lines are joined.
 * @returns {{ summaryLines: string[], groups: Map<string, string[]> }}
 */
export function parseSectionLines(sectionLines) {
  const summaryLines = [];
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  let currentHeading = null;
  let currentItem = null;

  const flushItem = () => {
    if (currentHeading && currentItem) {
      groups.get(currentHeading).push(currentItem.trim());
    }
    currentItem = null;
  };

  for (const line of sectionLines) {
    const headingMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flushItem();
      currentHeading = headingMatch[1];
      if (!groups.has(currentHeading)) {
        groups.set(currentHeading, []);
      }
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch && currentHeading) {
      flushItem();
      currentItem = bulletMatch[1];
      continue;
    }
    if (currentItem && /^\s+\S/.test(line)) {
      currentItem += ` ${line.trim()}`;
      continue;
    }
    if (!currentHeading && line.trim()) {
      summaryLines.push(line.trim());
    }
    if (!line.trim()) {
      flushItem();
    }
  }
  flushItem();
  return { summaryLines, groups };
}

/**
 * @returns {{ summary?: string, sections: { title: string, items: string[] }[] } | null}
 *   Items are plain text; `markdownSections` keeps the original Markdown for GitHub.
 */
export function extractReleaseNotes(changelog, version, { locale } = {}) {
  const sectionLines = findVersionSection(changelog, version);
  if (!sectionLines) {
    return null;
  }

  const { summaryLines, groups } = parseSectionLines(sectionLines);
  const knownOrder = SECTION_TITLES.map(([heading]) => heading);
  const headings = [...groups.keys()]
    .filter((heading) => groups.get(heading).length > 0)
    .sort((left, right) => {
      const leftIndex = knownOrder.indexOf(left);
      const rightIndex = knownOrder.indexOf(right);
      return (leftIndex === -1 ? knownOrder.length : leftIndex) - (rightIndex === -1 ? knownOrder.length : rightIndex);
    });

  if (headings.length === 0 && summaryLines.length === 0) {
    return null;
  }

  const titleFor = (heading) => LOCALIZED_SECTION_TITLES[locale]?.[heading]
    ?? SECTION_TITLES.find(([known]) => known === heading)?.[1]
    ?? heading;
  const summary = summaryLines.length ? toPlainText(summaryLines.join(" ")) : undefined;

  return {
    ...(summary ? { summary } : {}),
    sections: headings.map((heading) => ({
      title: titleFor(heading),
      items: groups.get(heading).map(toPlainText),
    })),
    markdownSections: headings.map((heading) => ({
      title: titleFor(heading),
      items: groups.get(heading),
    })),
    markdownSummary: summaryLines.join(" ") || undefined,
  };
}

/** GitHub release body: same groups and wording as the app and website. */
export function renderReleaseNotesMarkdown(notes, { websiteUrl, version } = {}) {
  const parts = [];
  if (notes.markdownSummary) {
    parts.push(notes.markdownSummary, "");
  }
  for (const section of notes.markdownSections) {
    parts.push(`### ${section.title}`, "");
    for (const item of section.items) {
      parts.push(`- ${item}`);
    }
    parts.push("");
  }
  if (websiteUrl && version) {
    parts.push(`Download: ${websiteUrl}/download/ · All releases: ${websiteUrl}/changelog/#v${version}`, "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/**
 * release.json `notes` shape (plain text only). `translations` maps a website
 * locale to the same shape; missing locales fall back to English on the site.
 */
export function toManifestNotes(notes, translations = {}) {
  const translated = Object.fromEntries(
    Object.entries(translations)
      .filter(([, value]) => value)
      .map(([locale, value]) => [locale, toManifestNotes(value)]),
  );
  return {
    ...(notes.summary ? { summary: notes.summary } : {}),
    sections: notes.sections,
    ...(Object.keys(translated).length ? { translations: translated } : {}),
  };
}

export function readChangelog(rootDir = ROOT_DIR, locale) {
  const fileName = locale ? `CHANGELOG.${locale}.md` : "CHANGELOG.md";
  const filePath = path.join(rootDir, fileName);
  if (locale && !fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

/** Translated notes for one version; `missing` lists locales without a section. */
export function extractTranslations(version, rootDir = ROOT_DIR) {
  const translations = {};
  const missing = [];
  for (const locale of TRANSLATION_LOCALES) {
    const notes = extractReleaseNotes(readChangelog(rootDir, locale), version, { locale });
    if (notes) {
      translations[locale] = notes;
    } else {
      missing.push(locale);
    }
  }
  return { translations, missing };
}

function runCli() {
  const args = new Map();
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args.set(argv[index].slice(2), value);
      index += 1;
    }
  }

  const version = (args.get("version") ?? "").replace(/^v/i, "");
  if (!version) {
    console.error("Missing required --version (e.g. 1.6.0)");
    process.exit(1);
  }

  const notes = extractReleaseNotes(readChangelog(), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no notes for ${version}. Add a "## [${version}] - YYYY-MM-DD" section first.`);
    process.exit(1);
  }

  const { translations, missing } = extractTranslations(version);
  if (missing.length) {
    // Translations never block a release; the website falls back to English.
    console.error(`Warning: no ${missing.join(", ")} translation for ${version} (CHANGELOG.<locale>.md); English is used.`);
  }

  const format = args.get("format") ?? "markdown";
  const output = format === "json"
    ? `${JSON.stringify(toManifestNotes(notes, translations), null, 2)}\n`
    : renderReleaseNotesMarkdown(notes, { websiteUrl: args.get("website-url"), version });

  const outputPath = args.get("output");
  if (outputPath) {
    fs.writeFileSync(path.resolve(process.cwd(), outputPath), output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
