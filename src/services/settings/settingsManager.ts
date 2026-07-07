import { IStorage } from '../storage/storage';
import { StorageFactory } from '../storage/storageFactory';
import {
  UserSettings,
  Theme,
  LayoutType,
  WindowSize,
  DEFAULT_SETTINGS,
  isContentParser,
} from './types';
import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';
import {
  SETTINGS_STORAGE_KEYS,
  mergeUserSettings,
  toNativeAppSettingsPatch,
  toRendererPreferences,
  extractNativeFieldsFromPartial,
  type RendererPreferences,
} from './storageModel';
import { loadNativeAppSettings, saveNativeAppSettings } from './nativeSettingsBackend';

const normalizeSmartViews = (smartViews: UserSettings['smartViews'] | undefined): UserSettings['smartViews'] => {
  const smartViewMap = new Map((smartViews ?? []).map((view) => [view.id, view]));

  return DEFAULT_SMART_VIEW_DEFINITIONS.map((definition, index) => {
    const existing = smartViewMap.get(definition.id);
    return {
      id: definition.id,
      visible: existing?.visible ?? true,
      sortOrder: existing?.sortOrder ?? index,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
};

const normalizeRendererPreferences = (preferences: Partial<RendererPreferences>): RendererPreferences => ({
  fontFamilies: {
    ...DEFAULT_SETTINGS.fontFamilies,
    ...preferences.fontFamilies,
  },
  readingLayout: {
    ...DEFAULT_SETTINGS.readingLayout,
    ...preferences.readingLayout,
  },
  sidebarLibrary: {
    ...DEFAULT_SETTINGS.sidebarLibrary,
    ...preferences.sidebarLibrary,
  },
  smartViews: normalizeSmartViews(preferences.smartViews),
  windowPosition: preferences.windowPosition,
});

const normalizeSettings = (settings: Partial<UserSettings>): UserSettings => ({
  theme: settings.theme ?? DEFAULT_SETTINGS.theme,
  layout: settings.layout ?? DEFAULT_SETTINGS.layout,
  sidebarWidth: settings.sidebarWidth ?? DEFAULT_SETTINGS.sidebarWidth,
  articleListWidth: settings.articleListWidth ?? DEFAULT_SETTINGS.articleListWidth,
  windowSize: {
    ...DEFAULT_SETTINGS.windowSize,
    ...settings.windowSize,
  },
  fontFamilies: {
    ...DEFAULT_SETTINGS.fontFamilies,
    ...settings.fontFamilies,
  },
  readingLayout: {
    ...DEFAULT_SETTINGS.readingLayout,
    ...settings.readingLayout,
  },
  backgroundUpdate: settings.backgroundUpdate ?? DEFAULT_SETTINGS.backgroundUpdate,
  contentParser: isContentParser(settings.contentParser)
    ? settings.contentParser
    : DEFAULT_SETTINGS.contentParser,
  savedArticlesSyncFolder: settings.savedArticlesSyncFolder ?? DEFAULT_SETTINGS.savedArticlesSyncFolder,
  sidebarLibrary: {
    ...DEFAULT_SETTINGS.sidebarLibrary,
    ...settings.sidebarLibrary,
  },
  smartViews: normalizeSmartViews(settings.smartViews),
});

/**
 * Settings manager with explicit storage boundaries:
 * - Native fields -> Rust `user-settings.json`
 * - Renderer preferences -> localStorage `user-settings-ui`
 */
class SettingsManager {
  private storage: IStorage;

  private migrationComplete = false;

  constructor() {
    this.storage = StorageFactory.getStorage();
  }

  private getSystemTheme(): Theme {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }

    return 'light';
  }

  private async loadRendererPreferences(): Promise<RendererPreferences> {
    const data = await this.storage.get(SETTINGS_STORAGE_KEYS.renderer);
    if (!data) {
      return normalizeRendererPreferences({});
    }

    try {
      return normalizeRendererPreferences(JSON.parse(data) as Partial<RendererPreferences>);
    } catch (error) {
      console.error('Error loading renderer preferences:', error);
      return normalizeRendererPreferences({});
    }
  }

  private async saveRendererPreferences(preferences: RendererPreferences): Promise<void> {
    await this.storage.set(
      SETTINGS_STORAGE_KEYS.renderer,
      JSON.stringify(normalizeRendererPreferences(preferences)),
    );
  }

  private async migrateLegacySettingsIfNeeded(): Promise<void> {
    if (this.migrationComplete) {
      return;
    }

    this.migrationComplete = true;

    const legacyRaw = await this.storage.get(SETTINGS_STORAGE_KEYS.legacy);
    const rendererRaw = await this.storage.get(SETTINGS_STORAGE_KEYS.renderer);
    if (!legacyRaw) {
      return;
    }

    try {
      const legacySettings = normalizeSettings(JSON.parse(legacyRaw) as Partial<UserSettings>);
      const renderer = rendererRaw
        ? normalizeRendererPreferences(JSON.parse(rendererRaw) as Partial<RendererPreferences>)
        : toRendererPreferences(legacySettings);

      await saveNativeAppSettings(toNativeAppSettingsPatch(legacySettings));
      await this.saveRendererPreferences(renderer);
      await this.storage.remove(SETTINGS_STORAGE_KEYS.legacy);
    } catch (error) {
      console.error('Error migrating legacy user settings:', error);
    }
  }

  private async migrateRendererWindowPositionToNative(
    native: Awaited<ReturnType<typeof loadNativeAppSettings>>,
    renderer: RendererPreferences,
  ): Promise<Awaited<ReturnType<typeof loadNativeAppSettings>>> {
    const hasNativePosition =
      native.windowSize.x !== undefined && native.windowSize.y !== undefined;
    const rendererPosition = renderer.windowPosition;

    if (hasNativePosition || !rendererPosition) {
      return native;
    }

    const { x, y } = rendererPosition;
    if (x === undefined && y === undefined) {
      return native;
    }

    await saveNativeAppSettings({
      windowSize: {
        width: native.windowSize.width,
        height: native.windowSize.height,
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      },
    });

    return loadNativeAppSettings();
  }

  /**
   * Load native + renderer stores and migrate any legacy settings blob.
   */
  async initialize(): Promise<UserSettings> {
    await this.migrateLegacySettingsIfNeeded();
    let native = await loadNativeAppSettings();
    const renderer = await this.loadRendererPreferences();
    native = await this.migrateRendererWindowPositionToNative(native, renderer);
    return mergeUserSettings(native, renderer);
  }

  async getSettings(): Promise<UserSettings> {
    try {
      await this.migrateLegacySettingsIfNeeded();
      const native = await loadNativeAppSettings();
      const renderer = await this.loadRendererPreferences();
      return mergeUserSettings(native, renderer);
    } catch (error) {
      console.error('Error loading settings:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    const normalized = normalizeSettings(settings);

    try {
      await saveNativeAppSettings(toNativeAppSettingsPatch(normalized));
      await this.saveRendererPreferences(toRendererPreferences(normalized));
    } catch (error) {
      console.error('Error saving settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  private async updateNativeSettings(patch: Partial<UserSettings>): Promise<void> {
    const nativePatch = extractNativeFieldsFromPartial(patch);
    if (Object.keys(nativePatch).length === 0) {
      return;
    }

    await saveNativeAppSettings(nativePatch);
  }

  private async updateRendererPreferences(patch: Partial<RendererPreferences>): Promise<void> {
    const current = await this.loadRendererPreferences();
    await this.saveRendererPreferences({
      ...current,
      ...patch,
      fontFamilies: patch.fontFamilies
        ? { ...current.fontFamilies, ...patch.fontFamilies }
        : current.fontFamilies,
      readingLayout: patch.readingLayout
        ? { ...current.readingLayout, ...patch.readingLayout }
        : current.readingLayout,
      sidebarLibrary: patch.sidebarLibrary
        ? { ...current.sidebarLibrary, ...patch.sidebarLibrary }
        : current.sidebarLibrary,
      smartViews: patch.smartViews ?? current.smartViews,
      windowPosition: patch.windowPosition ?? current.windowPosition,
    });
  }

  async getTheme(): Promise<Theme> {
    const settings = await this.getSettings();
    return settings.theme;
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.updateNativeSettings({ theme });
  }

  async getLayout(): Promise<LayoutType> {
    const settings = await this.getSettings();
    return settings.layout;
  }

  async setLayout(layout: LayoutType): Promise<void> {
    await this.updateNativeSettings({ layout });
  }

  async getSidebarWidth(): Promise<number> {
    const settings = await this.getSettings();
    return settings.sidebarWidth;
  }

  async setSidebarWidth(width: number): Promise<void> {
    await this.updateNativeSettings({ sidebarWidth: width });
  }

  async getArticleListWidth(): Promise<number> {
    const settings = await this.getSettings();
    return settings.articleListWidth;
  }

  async setArticleListWidth(width: number): Promise<void> {
    await this.updateNativeSettings({ articleListWidth: width });
  }

  async getWindowSize(): Promise<WindowSize> {
    const settings = await this.getSettings();
    return settings.windowSize;
  }

  async setWindowSize(size: WindowSize): Promise<void> {
    await this.updateNativeSettings({
      windowSize: {
        width: size.width,
        height: size.height,
        ...(size.x !== undefined ? { x: size.x } : {}),
        ...(size.y !== undefined ? { y: size.y } : {}),
      },
    });
  }

  async getFontFamilies(): Promise<UserSettings['fontFamilies']> {
    const settings = await this.getSettings();
    return settings.fontFamilies;
  }

  async getReadingLayout(): Promise<UserSettings['readingLayout']> {
    const settings = await this.getSettings();
    return settings.readingLayout;
  }

  async getSavedArticlesSyncFolder(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings.savedArticlesSyncFolder;
  }

  async setSavedArticlesSyncFolder(folderPath: string | null): Promise<void> {
    await this.updateNativeSettings({
      savedArticlesSyncFolder: folderPath && folderPath.trim().length > 0
        ? folderPath.trim()
        : null,
    });
  }

  async getSidebarLibrary(): Promise<UserSettings['sidebarLibrary']> {
    const settings = await this.getSettings();
    return settings.sidebarLibrary;
  }

  async setSidebarLibrary(sidebarLibrary: Partial<UserSettings['sidebarLibrary']>): Promise<void> {
    const current = await this.loadRendererPreferences();
    await this.updateRendererPreferences({
      sidebarLibrary: {
        ...current.sidebarLibrary,
        ...sidebarLibrary,
      },
    });
  }

  async getSmartViews(): Promise<UserSettings['smartViews']> {
    const settings = await this.getSettings();
    return normalizeSmartViews(settings.smartViews);
  }

  async setSmartViews(smartViews: UserSettings['smartViews']): Promise<void> {
    await this.updateRendererPreferences({ smartViews: normalizeSmartViews(smartViews) });
  }

  async setFontFamilies(fontFamilies: Partial<UserSettings['fontFamilies']>): Promise<void> {
    const current = await this.loadRendererPreferences();
    await this.updateRendererPreferences({
      fontFamilies: {
        ...current.fontFamilies,
        ...fontFamilies,
      },
    });
  }

  async setReadingLayout(readingLayout: Partial<UserSettings['readingLayout']>): Promise<void> {
    const current = await this.loadRendererPreferences();
    await this.updateRendererPreferences({
      readingLayout: {
        ...current.readingLayout,
        ...readingLayout,
      },
    });
  }

  async setUiFont(font: string): Promise<void> {
    await this.setFontFamilies({ uiFont: font });
  }

  async setArticleTitleFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleTitleFont: font });
  }

  async setArticleContentFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleContentFont: font });
  }

  async setArticleNonAsciiFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleNonAsciiFont: font });
  }

  async setBackgroundUpdate(mode: UserSettings['backgroundUpdate']): Promise<void> {
    await this.updateNativeSettings({ backgroundUpdate: mode });
  }

  async setContentParser(parser: UserSettings['contentParser']): Promise<void> {
    await this.updateNativeSettings({ contentParser: parser });
  }

  async resetSettings(): Promise<void> {
    const initialSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      theme: this.getSystemTheme(),
    };
    await this.saveSettings(initialSettings);
  }
}

export const settingsManager = new SettingsManager();
