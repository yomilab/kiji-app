import type { ShellContract } from "./contracts";
import { invokeContract } from "./core";

export async function updateMenuState(
  request: ShellContract["updateMenuState"]["request"],
): Promise<ShellContract["updateMenuState"]["response"]> {
  return invokeContract<ShellContract["updateMenuState"]>("shell_menu_update_state", request);
}

export async function openExternal(
  request: ShellContract["openExternal"]["request"],
): Promise<ShellContract["openExternal"]["response"]> {
  return invokeContract<ShellContract["openExternal"]>("shell_links_open_external", request);
}

export const dialog = {
  openFile(
    request: ShellContract["dialogOpenFile"]["request"],
  ): Promise<ShellContract["dialogOpenFile"]["response"]> {
    return invokeContract<ShellContract["dialogOpenFile"]>("shell_dialog_open_file", request);
  },
  readTextFile(
    request: ShellContract["readTextFile"]["request"],
  ): Promise<ShellContract["readTextFile"]["response"]> {
    return invokeContract<ShellContract["readTextFile"]>("shell_file_read_text", request);
  },
  writeTextFile(
    request: ShellContract["writeTextFile"]["request"],
  ): Promise<ShellContract["writeTextFile"]["response"]> {
    return invokeContract<ShellContract["writeTextFile"]>("shell_file_write_text", request);
  },
  saveFile(
    request: ShellContract["dialogSaveFile"]["request"],
  ): Promise<ShellContract["dialogSaveFile"]["response"]> {
    return invokeContract<ShellContract["dialogSaveFile"]>("shell_dialog_save_file", request);
  },
  pickFolder(
    request: ShellContract["dialogPickFolder"]["request"],
  ): Promise<ShellContract["dialogPickFolder"]["response"]> {
    return invokeContract<ShellContract["dialogPickFolder"]>(
      "shell_dialog_pick_folder",
      request,
    );
  },
};

export async function openArticleWindow(
  request: ShellContract["openArticleWindow"]["request"],
): Promise<ShellContract["openArticleWindow"]["response"]> {
  return invokeContract<ShellContract["openArticleWindow"]>("shell_article_window_open", request);
}

export async function share(
  request: ShellContract["share"]["request"],
): Promise<ShellContract["share"]["response"]> {
  return invokeContract<ShellContract["share"]>("shell_share", request);
}
