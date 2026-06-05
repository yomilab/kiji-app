export { tauriCommandCatalog } from "./commandCatalog";
import * as articles from "./articles";
import * as database from "./database";
import * as diagnostics from "./diagnostics";
import * as feeds from "./feeds";
import * as saved from "./saved";
import * as settings from "./settings";
import * as shell from "./shell";
import * as system from "./system";
import * as tasks from "./tasks";

export const tauriClient = {
  articles,
  database,
  diagnostics,
  feeds,
  saved,
  settings,
  shell,
  system,
  tasks,
};
