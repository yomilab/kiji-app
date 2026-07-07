import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kijiAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesRoot = path.resolve(kijiAppRoot, "test/data");

export const PARITY_FIXTURE_FILES = [
  "simon.xml",
  "feedwithimage.xml",
  "caminodetexas.xml",
  "Feeds.opml",
  "parsingHtml.html",
  "androidFeed.xml",
  "longbridge.xml",
] as const;

/** Total OPML feed outlines in `Feeds.opml`, including multi-station duplicates. */
export const FEEDS_OPML_ENTRY_COUNT = 580;
/** Unique feed URLs in `Feeds.opml`. */
export const FEEDS_OPML_UNIQUE_URL_COUNT = 403;

export type ParityFixtureFile = (typeof PARITY_FIXTURE_FILES)[number];

export function resolveParityFixturePath(name: ParityFixtureFile | string): string {
  return path.join(fixturesRoot, name);
}

export function readParityFixture(name: ParityFixtureFile | string): string {
  const fixturePath = resolveParityFixturePath(name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing parity fixture at ${fixturePath}.`);
  }

  return fs.readFileSync(fixturePath, "utf8");
}

export function parityFixturesAreAvailable(): boolean {
  return PARITY_FIXTURE_FILES.every((name) => fs.existsSync(resolveParityFixturePath(name)));
}
