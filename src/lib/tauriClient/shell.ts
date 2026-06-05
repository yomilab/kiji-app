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
