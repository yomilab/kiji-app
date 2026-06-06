import { settingsManager } from './settingsManager';
import type { UserSettings } from './types';
import type { AppSettingsPatch } from '@/lib/settings';
import {
  toNativeAppSettingsPatch,
} from './storageModel';

export {
  mergeUserSettings,
  toNativeAppSettings,
  toNativeAppSettingsPatch,
  SETTINGS_STORAGE_KEYS,
} from './storageModel';

/** @deprecated Use toNativeAppSettingsPatch instead. */
export function mapUserSettingsToNativePatch(settings: UserSettings): AppSettingsPatch {
  return toNativeAppSettingsPatch(settings);
}

/**
 * Ensure native and renderer settings stores are loaded and legacy blobs migrated.
 */
export async function initializeAppSettings(): Promise<UserSettings> {
  return settingsManager.initialize();
}

/** @deprecated Use initializeAppSettings instead. */
export async function syncNativeAppSettingsFromStorage(): Promise<void> {
  await settingsManager.initialize();
}
