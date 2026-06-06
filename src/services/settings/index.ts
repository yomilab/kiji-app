/**
 * Settings Module
 *
 * Provides centralized management for user settings including UI preferences
 */

export { settingsManager } from './settingsManager';
export {
  mapUserSettingsToNativePatch,
  toNativeAppSettingsPatch,
  initializeAppSettings,
  syncNativeAppSettingsFromStorage,
  SETTINGS_STORAGE_KEYS,
} from './nativeSettingsSync';
export {
  mergeUserSettings,
  toNativeAppSettings,
  toRendererPreferences,
  type RendererPreferences,
} from './storageModel';
export type { UserSettings, Theme, WindowSize, FontFamilySettings, ReadingLayoutSettings, ContentParser } from './types';
export { DEFAULT_SETTINGS, DEFAULT_CONTENT_PARSER } from './types';
