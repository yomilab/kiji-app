import type { ShellContract } from "./contracts";
import { invokeCommand, invokeContract } from "./core";

export async function openSettings(): Promise<ShellContract["openSettings"]["response"]> {
  return invokeContract<ShellContract["openSettings"]>("shell_settings_window_open");
}

export async function updateMenuState(
  request: ShellContract["updateMenuState"]["request"],
): Promise<ShellContract["updateMenuState"]["response"]> {
  return invokeCommand<ShellContract["updateMenuState"]["response"]>("shell_menu_update_state", { patch: request });
}

export async function showImageContextMenu(
  request: ShellContract["showImageContextMenu"]["request"],
): Promise<ShellContract["showImageContextMenu"]["response"]> {
  return invokeContract<ShellContract["showImageContextMenu"]>(
    "shell_context_menu_show_image",
    request,
  );
}

export async function listShareServices(): Promise<ShellContract["listShareServices"]["response"]> {
  return invokeContract<ShellContract["listShareServices"]>("shell_share_list_services");
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
    return invokeCommand<ShellContract["writeTextFile"]["response"]>("shell_file_write_text", { request });
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

export async function getArticleWindowData(): Promise<ShellContract["getArticleWindowData"]["response"]> {
  return invokeContract<ShellContract["getArticleWindowData"]>("shell_article_window_get_data");
}

export async function share(
  request: ShellContract["share"]["request"],
): Promise<ShellContract["share"]["response"]> {
  return invokeCommand<ShellContract["share"]["response"]>("shell_share", { request });
}

export async function shareToService(
  request: ShellContract["shareToService"]["request"],
): Promise<ShellContract["shareToService"]["response"]> {
  const { serviceId, ...shareRequest } = request;
  return invokeCommand<ShellContract["shareToService"]["response"]>("shell_share_to_service", {
    request: shareRequest,
    serviceId,
  });
}
