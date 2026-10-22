export { tauriCommandCatalog } from "./commandCatalog";
import * as articles from "./articles";
import * as assistant from "./assistant";
import * as database from "./database";
import * as diagnostics from "./diagnostics";
import * as feeds from "./feeds";
import * as muteRules from "./muteRules";
import * as saved from "./saved";
import * as scheduler from "./scheduler";
import * as settings from "./settings";
import * as shell from "./shell";
import * as system from "./system";
import * as tasks from "./tasks";

export const tauriClient = {
  articles,
  assistant,
  database,
  diagnostics,
  feeds,
  muteRules,
  saved,
  scheduler,
  settings,
  shell,
  system,
  tasks,
};
