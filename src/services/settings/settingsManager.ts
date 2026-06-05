import { IStorage } from '../storage/storage';
import { StorageFactory } from '../storage/storageFactory';
import { UserSettings, Theme, LayoutType, WindowSize, DEFAULT_SETTINGS, isContentParser } from './types';
import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';

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

// Rebuild persisted settings from known keys so removed fields do not leak back into storage.
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
  // Drop unknown stored values so a typo or downgrade can't pin the user to a missing parser.
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
 * Settings Manager Service
 *
 * Manages user settings including UI preferences like theme, sidebar width, and window size.
 * Uses the storage abstraction layer for persistence.
 */
class SettingsManager {
  private storage: IStorage;
  private readonly SETTINGS_KEY = 'user-settings';

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

  /**
   * Get all user settings
   * Returns default settings if none are saved
   */
  async getSettings(): Promise<UserSettings> {
    try {
      const data = await this.storage.get(this.SETTINGS_KEY);
      if (!data) {
        const initialSettings: UserSettings = {
          ...DEFAULT_SETTINGS,
          theme: this.getSystemTheme(),
        };
        await this.saveSettings(initialSettings);
        return initialSettings;
      }
      const settings = JSON.parse(data) as Partial<UserSettings>;
      return normalizeSettings(settings);
    } catch (error) {
      console.error('Error loading settings:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save all user settings
   */
  async saveSettings(settings: UserSettings): Promise<void> {
    try {
      await this.storage.set(this.SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    } catch (error) {
      console.error('Error saving settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  /**
   * Get current theme
   */
  async getTheme(): Promise<Theme> {
    const settings = await this.getSettings();
    return settings.theme;
  }

  /**
   * Set theme preference
   */
  async setTheme(theme: Theme): Promise<void> {
    const settings = await this.getSettings();
    settings.theme = theme;
    await this.saveSettings(settings);
  }

  /**
   * Get layout type
   */
  async getLayout(): Promise<LayoutType> {
    const settings = await this.getSettings();
    return settings.layout;
  }

  /**
   * Set layout type
   */
  async setLayout(layout: LayoutType): Promise<void> {
    const settings = await this.getSettings();
    settings.layout = layout;
    await this.saveSettings(settings);
  }

  /**
   * Get sidebar width
   */
  async getSidebarWidth(): Promise<number> {
    const settings = await this.getSettings();
    return settings.sidebarWidth;
  }

  /**
   * Set sidebar width
   */
  async setSidebarWidth(width: number): Promise<void> {
    const settings = await this.getSettings();
    settings.sidebarWidth = width;
    await this.saveSettings(settings);
  }

  /**
   * Get article list width
   */
  async getArticleListWidth(): Promise<number> {
    const settings = await this.getSettings();
    return settings.articleListWidth;
  }

  /**
   * Set article list width
   */
  async setArticleListWidth(width: number): Promise<void> {
    const settings = await this.getSettings();
    settings.articleListWidth = width;
    await this.saveSettings(settings);
  }

  /**
   * Get window size
   */
  async getWindowSize(): Promise<WindowSize> {
    const settings = await this.getSettings();
    return settings.windowSize;
  }

  /**
   * Set window size
   */
  async setWindowSize(size: WindowSize): Promise<void> {
    const settings = await this.getSettings();
    settings.windowSize = size;
    await this.saveSettings(settings);
  }

  /**
   * Get font families
   */
  async getFontFamilies(): Promise<UserSettings['fontFamilies']> {
    const settings = await this.getSettings();
    return settings.fontFamilies;
  }

  /**
   * Get reading layout settings.
   */
  async getReadingLayout(): Promise<UserSettings['readingLayout']> {
    const settings = await this.getSettings();
    return settings.readingLayout;
  }

  /**
   * Get the optional saved-articles sync folder path.
   */
  async getSavedArticlesSyncFolder(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings.savedArticlesSyncFolder;
  }

  /**
   * Set the optional saved-articles sync folder path.
   */
  async setSavedArticlesSyncFolder(folderPath: string | null): Promise<void> {
    const settings = await this.getSettings();
    settings.savedArticlesSyncFolder = folderPath && folderPath.trim().length > 0
      ? folderPath.trim()
      : null;
    await this.saveSettings(settings);
  }

  /**
   * Get sidebar library settings.
   */
  async getSidebarLibrary(): Promise<UserSettings['sidebarLibrary']> {
    const settings = await this.getSettings();
    return settings.sidebarLibrary;
  }

  /**
   * Update sidebar library settings.
   */
  async setSidebarLibrary(sidebarLibrary: Partial<UserSettings['sidebarLibrary']>): Promise<void> {
    const settings = await this.getSettings();
    settings.sidebarLibrary = {
      ...settings.sidebarLibrary,
      ...sidebarLibrary,
    };
    await this.saveSettings(settings);
  }

  /**
   * Get smart view settings.
   */
  async getSmartViews(): Promise<UserSettings['smartViews']> {
    const settings = await this.getSettings();
    return normalizeSmartViews(settings.smartViews);
  }

  /**
   * Update smart view settings.
   */
  async setSmartViews(smartViews: UserSettings['smartViews']): Promise<void> {
    const settings = await this.getSettings();
    settings.smartViews = normalizeSmartViews(smartViews);
    await this.saveSettings(settings);
  }

  /**
   * Set font families
   */
  async setFontFamilies(fontFamilies: Partial<UserSettings['fontFamilies']>): Promise<void> {
    const settings = await this.getSettings();
    settings.fontFamilies = {
      ...settings.fontFamilies,
      ...fontFamilies,
    };
    await this.saveSettings(settings);
  }

  /**
   * Update reading layout settings.
   */
  async setReadingLayout(readingLayout: Partial<UserSettings['readingLayout']>): Promise<void> {
    const settings = await this.getSettings();
    settings.readingLayout = {
      ...settings.readingLayout,
      ...readingLayout,
    };
    await this.saveSettings(settings);
  }

  /**
   * Set UI font (sidebar, modals, UI elements)
   */
  async setUiFont(font: string): Promise<void> {
    await this.setFontFamilies({ uiFont: font });
  }

  /**
   * Set article title font (article list titles and article-view header title)
   */
  async setArticleTitleFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleTitleFont: font });
  }

  /**
   * Set article content font (descriptions and all article body content)
   */
  async setArticleContentFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleContentFont: font });
  }

  /**
   * Set the dedicated non-ASCII reading font used in the article list and view.
   */
  async setArticleNonAsciiFont(font: string): Promise<void> {
    await this.setFontFamilies({ articleNonAsciiFont: font });
  }

  /**
   * Reset all settings to defaults
   */
  async resetSettings(): Promise<void> {
    await this.saveSettings({
      ...DEFAULT_SETTINGS,
      theme: this.getSystemTheme(),
    });
  }
}

// Export singleton instance
export const settingsManager = new SettingsManager();
