#!/usr/bin/env node
/**
 * Build latest.json, the file installed apps read to update themselves, from
 * the signed release assets in a folder.
 *
 * Usage:
 *   node scripts/generate-updater-manifest.mjs --dir release-assets --tag v2.0.0 --output latest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "yomilab/yomi-rss-reader";
const ASSET_PREFIX = "Yomi-Reader";

// deb and rpm are left out on purpose: installing them needs a password, so
// those apps keep the update badge.
const UPDATER_ASSETS = {
  "macos-aarch64.app.tar.gz": ["darwin-aarch64", "darwin-aarch64-app"],
  "macos-x86_64.app.tar.gz": ["darwin-x86_64", "darwin-x86_64-app"],
  "windows-x86_64-setup.exe": ["windows-x86_64", "windows-x86_64-nsis"],
  "windows-x86_64.msi": ["windows-x86_64-msi"],
  "windows-aarch64-setup.exe": ["windows-aarch64", "windows-aarch64-nsis"],
  "windows-aarch64.msi": ["windows-aarch64-msi"],
  "linux-x86_64.AppImage": ["linux-x86_64", "linux-x86_64-appimage"],
  "linux-aarch64.AppImage": ["linux-aarch64", "linux-aarch64-appimage"],
};

export function buildUpdaterManifest({ version, tag, pubDate, signatures }) {
  const platforms = {};
  for (const [suffix, targets] of Object.entries(UPDATER_ASSETS)) {
    const fileName = `${ASSET_PREFIX}-${version}-${suffix}`;
    const signature = signatures[fileName];
    if (!signature) {
      throw new Error(`Missing updater signature for ${fileName}`);
    }
    for (const target of targets) {
      platforms[target] = {
        url: `https://github.com/${REPO}/releases/download/${tag}/${fileName}`,
        signature: signature.trim(),
      };
    }
  }
  return { version, pub_date: pubDate, platforms };
}

function main() {
  const args = new Map();
  const rawArgs = process.argv.slice(2);
  for (let index = 0; index < rawArgs.length; index += 2) {
    args.set(rawArgs[index].replace(/^--/, ""), rawArgs[index + 1]);
  }
  const dir = args.get("dir");
  const tag = args.get("tag");
  const output = args.get("output") ?? "latest.json";
  if (!dir || !tag) {
    throw new Error("--dir and --tag are required");
  }
  const signatures = {};
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".sig")) {
      signatures[name.slice(0, -".sig".length)] = fs.readFileSync(path.join(dir, name), "utf8");
    }
  }
  const manifest = buildUpdaterManifest({
    version: tag.replace(/^v/, ""),
    tag,
    pubDate: new Date().toISOString(),
    signatures,
  });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(manifest.platforms).length} update targets to ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
