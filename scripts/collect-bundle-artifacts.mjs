#!/usr/bin/env node
/**
 * Normalize Tauri bundle outputs into stable release artifact names.
 *
 * Usage:
 *   node scripts/collect-bundle-artifacts.mjs --profile release --platform macos-aarch64
 *   node scripts/collect-bundle-artifacts.mjs --profile debug --platform linux-x86_64 --target x86_64-unknown-linux-gnu
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productName = "KiJi";
const version = JSON.parse(
  fs.readFileSync(path.join(rootDir, "src-tauri/tauri.conf.json"), "utf8"),
).version;

function parseArgs(argv) {
  const options = {
    profile: "release",
    platform: null,
    target: null,
    outDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }
    if (arg === "--platform") {
      options.platform = argv[++index];
      continue;
    }
    if (arg === "--target") {
      options.target = argv[++index];
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = argv[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.platform) {
    throw new Error("--platform is required");
  }

  return options;
}

function bundleRoot(profile, target) {
  const base = path.join(rootDir, "src-tauri/target");
  if (target) {
    return path.join(base, target, profile, "bundle");
  }
  return path.join(base, profile, "bundle");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

function firstMatch(dirPath, matcher) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    if (matcher(entry, fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function zipMacApp(appPath, zipPath) {
  ensureDir(path.dirname(zipPath));
  const result = spawnSync(
    "ditto",
    ["-c", "-k", "--keepParent", appPath, zipPath],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to zip macOS app bundle: ${appPath}`);
  }
  return zipPath;
}

function collectArtifacts({ profile, platform, target, outDir }) {
  const bundleDir = bundleRoot(profile, target);
  const outputDir =
    outDir ?? path.join(bundleDir, "artifacts", platform, profile);
  ensureDir(outputDir);

  const artifacts = [];

  if (platform.startsWith("macos-")) {
    const appPath = path.join(bundleDir, "macos", `${productName}.app`);
    if (!fs.existsSync(appPath)) {
      throw new Error(`Missing macOS app bundle: ${appPath}`);
    }

    const dmgPath = firstMatch(path.join(bundleDir, "dmg"), (name) =>
      name.endsWith(".dmg"),
    );
    if (dmgPath) {
      artifacts.push(
        copyFile(dmgPath, path.join(outputDir, `${productName}-${platform}.dmg`)),
      );
    }

    artifacts.push(
      zipMacApp(
        appPath,
        path.join(outputDir, `${productName}-${platform}.app.zip`),
      ),
    );
    return { bundleDir, outputDir, artifacts };
  }

  if (platform === "windows-x86_64") {
    const msiPath = firstMatch(path.join(bundleDir, "msi"), (name) =>
      name.endsWith(".msi"),
    );
    if (msiPath) {
      artifacts.push(
        copyFile(msiPath, path.join(outputDir, `${productName}-${platform}.msi`)),
      );
    }

    const nsisPath = firstMatch(path.join(bundleDir, "nsis"), (name) =>
      name.endsWith("-setup.exe") || name.endsWith(".exe"),
    );
    if (nsisPath) {
      artifacts.push(
        copyFile(
          nsisPath,
          path.join(outputDir, `${productName}-${platform}-setup.exe`),
        ),
      );
    }

    if (artifacts.length === 0) {
      throw new Error(`No Windows bundle artifacts found under ${bundleDir}`);
    }

    return { bundleDir, outputDir, artifacts };
  }

  if (platform === "linux-x86_64") {
    const debPath = firstMatch(path.join(bundleDir, "deb"), (name) =>
      name.endsWith(".deb"),
    );
    if (debPath) {
      artifacts.push(
        copyFile(debPath, path.join(outputDir, `${productName}-${platform}.deb`)),
      );
    }

    const rpmPath = firstMatch(path.join(bundleDir, "rpm"), (name) =>
      name.endsWith(".rpm"),
    );
    if (rpmPath) {
      artifacts.push(
        copyFile(rpmPath, path.join(outputDir, `${productName}-${platform}.rpm`)),
      );
    }

    const appImagePath = firstMatch(path.join(bundleDir, "appimage"), (name) =>
      name.endsWith(".AppImage"),
    );
    if (appImagePath) {
      artifacts.push(
        copyFile(
          appImagePath,
          path.join(outputDir, `${productName}-${platform}.AppImage`),
        ),
      );
    }

    if (artifacts.length === 0) {
      throw new Error(`No Linux bundle artifacts found under ${bundleDir}`);
    }

    return { bundleDir, outputDir, artifacts };
  }

  throw new Error(`Unsupported platform id: ${platform}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = collectArtifacts(options);
  console.log(
    `[collect-bundle-artifacts] v${version} ${options.platform} (${options.profile})`,
  );
  for (const artifact of result.artifacts) {
    console.log(`  - ${artifact}`);
  }
}

main();
