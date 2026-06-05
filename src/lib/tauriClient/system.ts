import type { SystemContract } from "./contracts";
import { invokeContract } from "./core";

export const appIcon = {
  getState(): Promise<SystemContract["appIconGetState"]["response"]> {
    return invokeContract<SystemContract["appIconGetState"]>("system_app_icon_get_state");
  },
};

export const clipboard = {
  readText(): Promise<SystemContract["clipboardReadText"]["response"]> {
    return invokeContract<SystemContract["clipboardReadText"]>("system_clipboard_read_text");
  },
  writeText(
    request: SystemContract["clipboardWriteText"]["request"],
  ): Promise<SystemContract["clipboardWriteText"]["response"]> {
    return invokeContract<SystemContract["clipboardWriteText"]>(
      "system_clipboard_write_text",
      request,
    );
  },
};
