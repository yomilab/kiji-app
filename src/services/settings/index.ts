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
export type { UserSettings, Theme, UiThemeVariant, WindowSize, FontFamilySettings, ReadingLayoutSettings, ContentParser, ArticleRetention } from './types';
export { DEFAULT_SETTINGS, DEFAULT_CONTENT_PARSER, UI_THEME_VARIANT_OPTIONS } from './types';
export {
  DEFAULT_READER_THEME,
  READER_THEMES,
  findReaderTheme,
  resolveActiveReaderTheme,
  resolveThemedFontFamilies,
  resolveThemedReadingLayout,
  type ReaderTheme,
} from './readerThemes';
export {
  SURFACE_FILL_OPACITY_MIN,
  SURFACE_FILL_OPACITY_MAX,
  applySurfaceFillOpacityToRoot,
  clampSurfaceFillOpacity,
  defaultSurfaceFillOpacityForOs,
} from './surfaceFillOpacity';
