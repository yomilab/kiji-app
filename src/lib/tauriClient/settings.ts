import type { AppSettings, AppSettingsPatch } from "../settings";
import { invokeCommand } from "./core";

export async function get(): Promise<AppSettings> {
  return invokeCommand<AppSettings>("settings_get");
}

export async function update(patch: AppSettingsPatch): Promise<AppSettings> {
  return invokeCommand<AppSettings>("settings_update", { patch });
}

export async function reset(): Promise<AppSettings> {
  return invokeCommand<AppSettings>("settings_reset");
}

