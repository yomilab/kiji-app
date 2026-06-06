import { tauriClient } from '@/lib/tauriClient';
import type { AppSettingsPatch } from '@/lib/settings';
import type { UserSettings } from './types';
import { settingsManager } from './settingsManager';

export function mapUserSettingsToNativePatch(settings: UserSettings): AppSettingsPatch {
  return {
    theme: settings.theme,
    layout: settings.layout,
    sidebarWidth: settings.sidebarWidth,
    articleListWidth: settings.articleListWidth,
    windowSize: settings.windowSize,
    backgroundUpdate: settings.backgroundUpdate,
    contentParser: settings.contentParser,
    savedArticlesSyncFolder: settings.savedArticlesSyncFolder,
  };
}

/**
 * Push renderer-persisted settings into the Rust settings store so native
 * services like saved-article folder sync can read the configured folder path.
 */
export async function syncNativeAppSettingsFromStorage(): Promise<void> {
  const settings = await settingsManager.getSettings();
  await tauriClient.settings.update(mapUserSettingsToNativePatch(settings));
}
