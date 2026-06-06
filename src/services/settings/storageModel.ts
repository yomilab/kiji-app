import type { AppSettings, AppSettingsPatch } from '@/lib/settings';
import type {
  FontFamilySettings,
  ReadingLayoutSettings,
  SidebarLibrarySettings,
  SmartViewSettings,
  UserSettings,
  WindowSize,
} from './types';

/**
 * Storage boundaries for KiJi Tauri (see kiji-doc docs/tauri/architecture-tauri-app.md):
 *
 * - SQLite (`kiji.db`): feeds, articles, tags, saved articles
 * - Rust JSON (`user-settings.json`): native app config consumed by the Rust runtime
 * - Renderer localStorage (`user-settings-ui`): UI-only preferences not required by Rust services
 *
 * The legacy Electron key `user-settings` is migrated once, then retired.
 */
export const SETTINGS_STORAGE_KEYS = {
  legacy: 'user-settings',
  renderer: 'user-settings-ui',
} as const;

export const NATIVE_APP_SETTING_KEYS = [
  'theme',
  'layout',
  'sidebarWidth',
  'articleListWidth',
  'windowSize',
  'backgroundUpdate',
  'contentParser',
  'savedArticlesSyncFolder',
] as const satisfies readonly (keyof AppSettings)[];

export interface RendererPreferences {
  fontFamilies: FontFamilySettings;
  readingLayout: ReadingLayoutSettings;
  sidebarLibrary: SidebarLibrarySettings;
  smartViews: SmartViewSettings[];
  windowPosition?: Pick<WindowSize, 'x' | 'y'>;
}

export function toNativeAppSettings(settings: UserSettings): AppSettings {
  return {
    theme: settings.theme,
    layout: settings.layout,
    sidebarWidth: settings.sidebarWidth,
    articleListWidth: settings.articleListWidth,
    windowSize: {
      width: settings.windowSize.width,
      height: settings.windowSize.height,
    },
    backgroundUpdate: settings.backgroundUpdate,
    contentParser: settings.contentParser,
    savedArticlesSyncFolder: settings.savedArticlesSyncFolder,
  };
}

export function toNativeAppSettingsPatch(settings: UserSettings): AppSettingsPatch {
  return toNativeAppSettings(settings);
}

export function toRendererPreferences(settings: UserSettings): RendererPreferences {
  const { x, y, width, height } = settings.windowSize;
  void width;
  void height;

  return {
    fontFamilies: settings.fontFamilies,
    readingLayout: settings.readingLayout,
    sidebarLibrary: settings.sidebarLibrary,
    smartViews: settings.smartViews,
    windowPosition: x !== undefined || y !== undefined ? { x, y } : undefined,
  };
}

export function mergeUserSettings(
  native: AppSettings,
  renderer: RendererPreferences,
): UserSettings {
  return {
    theme: native.theme,
    layout: native.layout,
    sidebarWidth: native.sidebarWidth,
    articleListWidth: native.articleListWidth,
    windowSize: {
      width: native.windowSize.width,
      height: native.windowSize.height,
      ...renderer.windowPosition,
    },
    backgroundUpdate: native.backgroundUpdate,
    contentParser: native.contentParser,
    savedArticlesSyncFolder: native.savedArticlesSyncFolder,
    fontFamilies: renderer.fontFamilies,
    readingLayout: renderer.readingLayout,
    sidebarLibrary: renderer.sidebarLibrary,
    smartViews: renderer.smartViews,
  };
}

export function extractNativeFieldsFromPartial(
  settings: Partial<UserSettings>,
): AppSettingsPatch {
  const patch: AppSettingsPatch = {};

  if (settings.theme !== undefined) patch.theme = settings.theme;
  if (settings.layout !== undefined) patch.layout = settings.layout;
  if (settings.sidebarWidth !== undefined) patch.sidebarWidth = settings.sidebarWidth;
  if (settings.articleListWidth !== undefined) patch.articleListWidth = settings.articleListWidth;
  if (settings.backgroundUpdate !== undefined) patch.backgroundUpdate = settings.backgroundUpdate;
  if (settings.contentParser !== undefined) patch.contentParser = settings.contentParser;
  if (settings.savedArticlesSyncFolder !== undefined) {
    patch.savedArticlesSyncFolder = settings.savedArticlesSyncFolder;
  }
  if (settings.windowSize !== undefined) {
    patch.windowSize = {
      width: settings.windowSize.width,
      height: settings.windowSize.height,
    };
  }

  return patch;
}
