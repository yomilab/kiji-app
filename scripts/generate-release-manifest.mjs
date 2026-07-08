#!/usr/bin/env node
/**
 * Build website-ready release.json from a published GitHub Release.
 *
 * Usage:
 *   node scripts/generate-release-manifest.mjs --tag v1.0.1 --output release.json
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT_NAME = "KiJi";
const REPO = "yomilab/kiji-app";
const WEBSITE_URL = "https://kiji.yomilab.app";

const args = new Map();
for (let index = 0; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) {
    continue;
  }
  const key = arg.slice(2);
  const value = process.argv[index + 1];
  if (value && !value.startsWith("--")) {
    args.set(key, value);
    index += 1;
  }
}

const tag = args.get("tag");
const outputPath = path.resolve(ROOT_DIR, args.get("output") ?? "release.json");

if (!tag) {
  console.error("Missing required --tag (e.g. v1.0.1)");
  process.exit(1);
}

const version =
  args.get("version") ??
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "src-tauri/tauri.conf.json"), "utf8")).version;

const FILE_TYPE = {
  ".dmg": "DMG",
  ".zip": "ZIP",
  ".msi": "MSI",
  ".exe": "EXE",
  ".deb": "DEB",
  ".rpm": "RPM",
  ".AppImage": "APPIMAGE",
};

/** @type {Record<string, { id: string, platform: string, label: string, detail: string }>} */
const ASSET_META = {
  "macos-aarch64.dmg": {
    id: "mac-arm64",
    platform: "mac",
    label: "macOS Apple Silicon",
    detail: "Recommended for M1, M2, M3, and newer Macs",
  },
  "macos-x86_64.dmg": {
    id: "mac-x64",
    platform: "mac",
    label: "macOS Intel",
    detail: "For Intel-based Macs",
  },
  "macos-aarch64.app.zip": {
    id: "mac-arm64-zip",
    platform: "mac",
    label: "macOS Apple Silicon",
    detail: "Portable .app archive",
  },
  "macos-x86_64.app.zip": {
    id: "mac-x64-zip",
    platform: "mac",
    label: "macOS Intel",
    detail: "Portable .app archive",
  },
  "windows-x86_64.msi": {
    id: "windows-x64",
    platform: "windows",
    label: "Windows x64",
    detail: "Recommended for most Windows PCs",
  },
  "windows-aarch64.msi": {
    id: "windows-arm64",
    platform: "windows",
    label: "Windows ARM64",
    detail: "For ARM-based Windows devices",
  },
  "windows-x86_64-setup.exe": {
    id: "windows-x64-setup",
    platform: "windows",
    label: "Windows x64",
    detail: "NSIS installer executable",
  },
  "windows-aarch64-setup.exe": {
    id: "windows-arm64-setup",
    platform: "windows",
    label: "Windows ARM64",
    detail: "NSIS installer executable",
  },
  "linux-x86_64.AppImage": {
    id: "linux-x86_64-appimage",
    platform: "linux",
    label: "Linux x64",
    detail: "Portable AppImage for most Linux desktops",
  },
  "linux-x86_64.deb": {
    id: "linux-x86_64-deb",
    platform: "linux",
    label: "Linux x64 Debian/Ubuntu",
    detail: "For Debian, Ubuntu, and compatible distributions",
  },
  "linux-x86_64.rpm": {
    id: "linux-x86_64-rpm",
    platform: "linux",
    label: "Linux x64 Fedora/RHEL",
    detail: "For Fedora, RHEL, and compatible distributions",
  },
  "linux-aarch64.AppImage": {
    id: "linux-aarch64-appimage",
    platform: "linux",
    label: "Linux ARM64",
    detail: "Portable AppImage for ARM64 Linux",
  },
  "linux-aarch64.deb": {
    id: "linux-aarch64-deb",
    platform: "linux",
    label: "Linux ARM64 Debian/Ubuntu",
    detail: "For ARM64 Debian, Ubuntu, and compatible distributions",
  },
  "linux-aarch64.rpm": {
    id: "linux-aarch64-rpm",
    platform: "linux",
    label: "Linux ARM64 Fedora/RHEL",
    detail: "For ARM64 Fedora, RHEL, and compatible distributions",
  },
};

function extensionOf(fileName) {
  if (fileName.endsWith(".app.zip")) {
    return ".zip";
  }
  if (fileName.endsWith(".AppImage")) {
    return ".AppImage";
  }
  return path.extname(fileName);
}

function platformKey(fileName, releaseVersion) {
  const prefix = `${PRODUCT_NAME}-${releaseVersion}-`;
  if (!fileName.startsWith(prefix)) {
    return null;
  }
  const remainder = fileName.slice(prefix.length);
  if (remainder.endsWith(".app.zip")) {
    return `${remainder.slice(0, -".app.zip".length)}.app.zip`;
  }
  return remainder;
}

function readRelease(tagName) {
  const raw = execSync(`gh release view "${tagName}" --repo "${REPO}" --json tagName,publishedAt,assets`, {
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

const release = readRelease(tag);
const downloadOptions = [];

for (const asset of release.assets ?? []) {
  const key = platformKey(asset.name, version);
  if (!key || !ASSET_META[key]) {
    continue;
  }
  const meta = ASSET_META[key];
  const fileType = FILE_TYPE[extensionOf(asset.name)] ?? "FILE";
  downloadOptions.push({
    id: meta.id,
    platform: meta.platform,
    label: meta.label,
    detail: meta.detail,
    fileType,
    fileName: asset.name,
    version,
    url: `https://github.com/${REPO}/releases/download/${release.tagName}/${asset.name}`,
    size: asset.size,
  });
}

if (downloadOptions.length === 0) {
  console.error(`No recognized KiJi release assets found for ${tag}`);
  process.exit(1);
}

const manifest = {
  productName: PRODUCT_NAME,
  version,
  tag: release.tagName,
  date: release.publishedAt ?? new Date().toISOString(),
  notesUrl: `https://github.com/${REPO}/releases/tag/${release.tagName}`,
  updatesFeedUrl: `${WEBSITE_URL}/feed.xml`,
  checksumsUrl: `https://github.com/${REPO}/releases/tag/${release.tagName}`,
  downloadOptions,
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${downloadOptions.length} download options to ${outputPath}`);
