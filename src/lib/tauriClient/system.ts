import type { SystemContract } from "./contracts";
import { invokeContract } from "./core";

export const appIcon = {
  getState(): Promise<SystemContract["appIconGetState"]["response"]> {
    return invokeContract<SystemContract["appIconGetState"]>("system_app_icon_get_state");
  },
  setVariant(
    request: SystemContract["appIconSetVariant"]["request"],
  ): Promise<SystemContract["appIconSetVariant"]["response"]> {
    return invokeContract<SystemContract["appIconSetVariant"]>(
      "system_app_icon_set_variant",
      request,
    );
  },
  pick(): Promise<SystemContract["appIconPick"]["response"]> {
    return invokeContract<SystemContract["appIconPick"]>("system_app_icon_pick");
  },
  reset(): Promise<SystemContract["appIconReset"]["response"]> {
    return invokeContract<SystemContract["appIconReset"]>("system_app_icon_reset");
  },
};

export const app = {
  relaunch(): Promise<SystemContract["appRelaunch"]["response"]> {
    return invokeContract<SystemContract["appRelaunch"]>("system_app_relaunch");
  },
};

export const theme = {
  getAccentColor(): Promise<SystemContract["themeGetAccentColor"]["response"]> {
    return invokeContract<SystemContract["themeGetAccentColor"]>("system_theme_get_accent_color");
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
