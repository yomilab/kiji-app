#!/usr/bin/env node
/**
 * Pack the Claude Desktop extension (.mcpb) and render the MCP Registry
 * server.json for a release.
 *
 * The bundle holds only a launcher script that runs `Yomi Reader.app/.../kiji-app --mcp`;
 * the server itself lives in the app. Templates: src-tauri/mcp/.
 *
 * Usage:
 *   node scripts/build-mcpb.mjs [--out dist/mcp] [--repo yomilab/kiji-release] [--tag v1.7.0]
 *
 * Outputs (in --out):
 *   yomi-reader-mcp-<version>-darwin.mcpb   (file name must contain "mcp" for the registry)
 *   yomi-reader-mcp-<version>-darwin.mcpb.sha256
 *   server.json                      (upload with `mcp-publisher publish`)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = path.join(rootDir, "src-tauri/mcp");
const version = JSON.parse(fs.readFileSync(path.join(rootDir, "src-tauri/tauri.conf.json"), "utf8")).version;
const DEFAULT_LAUNCHER = "/Applications/Yomi Reader.app/Contents/MacOS/kiji-app";

function parseArgs(argv) {
  const options = { out: path.join(rootDir, "dist/mcp"), repo: "yomilab/kiji-release", tag: `v${version}` };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = path.resolve(argv[++index]);
    else if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--tag") options.tag = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function render(template, replacements) {
  let text = fs.readFileSync(path.join(templateDir, template), "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    text = text.split(key).join(value);
  }
  if (/__[A-Z0-9_]+__/.test(text)) {
    throw new Error(`${template}: unreplaced placeholder`);
  }
  return text;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.out, { recursive: true });

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "yomi-reader-mcpb-"));
  fs.mkdirSync(path.join(staging, "server"));
  const manifest = render("manifest.json", { __VERSION__: version });
  JSON.parse(manifest); // must stay valid JSON
  fs.writeFileSync(path.join(staging, "manifest.json"), manifest);
  const launcherPath = path.join(staging, "server/yomi-reader-mcp");
  fs.writeFileSync(launcherPath, render("yomi-reader-mcp.sh", { __KIJI_LAUNCHER__: DEFAULT_LAUNCHER }));
  fs.chmodSync(launcherPath, 0o755);
  fs.copyFileSync(path.join(rootDir, "src-tauri/icons/icon.png"), path.join(staging, "icon.png"));

  const fileName = `yomi-reader-mcp-${version}-darwin.mcpb`;
  const bundlePath = path.join(options.out, fileName);
  fs.rmSync(bundlePath, { force: true });
  // `zip -X` keeps the launcher's executable bit and drops extra attributes.
  const zip = spawnSync("zip", ["-X", "-r", bundlePath, "manifest.json", "server", "icon.png"], {
    cwd: staging,
    stdio: "inherit",
  });
  fs.rmSync(staging, { recursive: true, force: true });
  if (zip.status !== 0) {
    throw new Error("zip failed");
  }

  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  fs.writeFileSync(`${bundlePath}.sha256`, `${sha256}  ${fileName}\n`);

  const url = `https://github.com/${options.repo}/releases/download/${options.tag}/${fileName}`;
  const serverJson = render("server.json", {
    __VERSION__: version,
    __MCPB_URL__: url,
    __MCPB_SHA256__: sha256,
  });
  JSON.parse(serverJson);
  fs.writeFileSync(path.join(options.out, "server.json"), serverJson);

  console.log(`Packed ${path.relative(rootDir, bundlePath)}`);
  console.log(`sha256 ${sha256}`);
  console.log(`server.json → ${path.relative(rootDir, path.join(options.out, "server.json"))} (${url})`);
}

main();
