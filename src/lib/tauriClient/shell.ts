import type { ShellContract } from "./contracts";
import { invokeCommand, invokeContract } from "./core";

export async function openSettings(): Promise<ShellContract["openSettings"]["response"]> {
  return invokeContract<ShellContract["openSettings"]>("shell_settings_window_open");
}

export async function openManageFeeds(
  target: ShellContract["openManageFeeds"]["request"]["target"],
): Promise<ShellContract["openManageFeeds"]["response"]> {
  return invokeCommand<ShellContract["openManageFeeds"]["response"]>(
    "shell_manage_feeds_window_open",
    { target },
  );
}

export async function takeManageFeedsTarget(): Promise<ShellContract["takeManageFeedsTarget"]["response"]> {
  return invokeContract<ShellContract["takeManageFeedsTarget"]>("shell_manage_feeds_window_take_target");
}

export async function runMainWindowCommand(
  command: ShellContract["runMainWindowCommand"]["request"]["command"],
): Promise<ShellContract["runMainWindowCommand"]["response"]> {
  return invokeCommand<ShellContract["runMainWindowCommand"]["response"]>(
    "shell_main_window_command",
    { command },
  );
}

export async function setTrafficLightsVisible(
  visible: ShellContract["setTrafficLightsVisible"]["request"]["visible"],
): Promise<ShellContract["setTrafficLightsVisible"]["response"]> {
  return invokeCommand<ShellContract["setTrafficLightsVisible"]["response"]>(
    "shell_window_set_traffic_lights_visible",
    { visible },
  );
}

export async function updateMenuState(
  request: ShellContract["updateMenuState"]["request"],
): Promise<ShellContract["updateMenuState"]["response"]> {
  return invokeCommand<ShellContract["updateMenuState"]["response"]>("shell_menu_update_state", { patch: request });
}

export async function showImageContextMenu(
  request: ShellContract["showImageContextMenu"]["request"],
): Promise<ShellContract["showImageContextMenu"]["response"]> {
  return invokeCommand<ShellContract["showImageContextMenu"]["response"]>(
    "shell_context_menu_show_image",
    { request },
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

export async function confirmDialog(
  request: ShellContract["dialogConfirm"]["request"],
): Promise<ShellContract["dialogConfirm"]["response"]> {
  return invokeCommand<ShellContract["dialogConfirm"]["response"]>(
    "shell_dialog_confirm",
    { request },
  );
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

export async function openUpdateWindow(
  request: ShellContract["openUpdateWindow"]["request"],
): Promise<ShellContract["openUpdateWindow"]["response"]> {
  return invokeCommand<ShellContract["openUpdateWindow"]["response"]>("shell_update_window_open", { payload: request });
}

export async function getUpdateWindowData(): Promise<ShellContract["getUpdateWindowData"]["response"]> {
  return invokeContract<ShellContract["getUpdateWindowData"]>("shell_update_window_get_data");
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

export interface BackgroundModeStatus {
  /** Closing the main window hides it instead of quitting. */
  enabled: boolean;
  platform: "macos" | "windows" | "linux";
  /** Windows/Linux: the tray icon is showing, so closing will hide. */
  trayReady: boolean;
}

export const backgroundMode = {
  get(): Promise<BackgroundModeStatus> {
    return invokeCommand<BackgroundModeStatus>("shell_background_mode_get");
  },
  set(enabled: boolean): Promise<BackgroundModeStatus> {
    return invokeCommand<BackgroundModeStatus>("shell_background_mode_set", { enabled });
  },
};
