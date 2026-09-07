import { logger } from '@/services/logger';
import { appToastService } from '@/services/ui/appToastService';

export const SETTINGS_WINDOW_OPEN_FAILED_TOAST =
  'Failed to open Settings. Check console for details.';

/** Open Settings from gear, File → Settings…, or Ctrl/Cmd+,. Toast genuine invoke failures. */
export async function openSettingsWindow(): Promise<void> {
  if (!window.kijiAPI?.openSettings) {
    return;
  }
  try {
    await window.kijiAPI.openSettings();
  } catch (error) {
    logger.error('Settings', 'Failed to open settings window', { error });
    appToastService.show(SETTINGS_WINDOW_OPEN_FAILED_TOAST);
  }
}
