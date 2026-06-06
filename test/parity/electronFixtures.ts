import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kijiAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const electronFixturesRoot = path.resolve(kijiAppRoot, "../kiji-electron/test/data");

export const ELECTRON_FIXTURE_FILES = [
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

export type ElectronFixtureFile = (typeof ELECTRON_FIXTURE_FILES)[number];

export function resolveElectronFixturePath(name: ElectronFixtureFile | string): string {
  return path.join(electronFixturesRoot, name);
}

export function readElectronFixture(name: ElectronFixtureFile | string): string {
  const fixturePath = resolveElectronFixturePath(name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing Electron parity fixture at ${fixturePath}. Ensure ../kiji-electron is checked out beside ../kiji-app.`,
    );
  }

  return fs.readFileSync(fixturePath, "utf8");
}

export function electronFixturesAreAvailable(): boolean {
  return ELECTRON_FIXTURE_FILES.every((name) => fs.existsSync(resolveElectronFixturePath(name)));
}
