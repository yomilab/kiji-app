import fs from "node:fs";
import path from "node:path";

export function writeE2eCommand(e2eDir, name, payload = {}) {
  const commandsDir = path.join(e2eDir, "commands");
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, `${name}.json`), JSON.stringify(payload));
}

export function readHarnessExport(e2eDir, relativePath = "exports/feeds.opml") {
  const exportPath = path.join(e2eDir, relativePath);
  if (!fs.existsSync(exportPath)) {
    return null;
  }
  return fs.readFileSync(exportPath, "utf8");
}
