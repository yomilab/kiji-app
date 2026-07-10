import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  APP_NAME,
  APP_WEBSITE_URL,
  CONTACT_EMAIL_ADDRESS,
} from '@/config/appIdentity';
import type { AppMenuCommand } from '@/types/appMenu';
import { appToastService } from '@/services/ui/appToastService';
import { publishAppMenuCommand } from '@/services/ui/appMenuCommandBus';
import { logger } from '@/services/logger';
import type { AppMenuAction, AppMenuLocalAction } from '@/services/ui/appMenuModel';

function isLocalAction(action: AppMenuAction): action is AppMenuLocalAction {
  return (
    action.type === 'openSettings'
    || action.type === 'about'
    || action.type === 'quit'
    || action.type === 'helpSupport'
    || action.type === 'helpWebsite'
  );
}

async function dispatchLocalAction(action: AppMenuLocalAction): Promise<void> {
  switch (action.type) {
    case 'openSettings':
      await window.kijiAPI?.openSettings();
      return;
    case 'about': {
      try {
        const version = await getVersion();
        appToastService.show(`${APP_NAME} ${version}`);
      } catch (error) {
        logger.error('AppMenu', 'Failed to read app version for About', { error });
        appToastService.show(APP_NAME);
      }
      return;
    }
    case 'quit':
      await getCurrentWindow().close();
      return;
    case 'helpSupport': {
      const subject = encodeURIComponent(`${APP_NAME} Support`);
      await window.kijiAPI?.openExternal(
        `mailto:${CONTACT_EMAIL_ADDRESS}?subject=${subject}`,
      );
      return;
    }
    case 'helpWebsite':
      await window.kijiAPI?.openExternal(APP_WEBSITE_URL);
      return;
    default:
      return;
  }
}

/** Route an in-app menu action through the same handlers as the native menu. */
export async function dispatchAppMenuAction(action: AppMenuAction): Promise<void> {
  if (isLocalAction(action)) {
    await dispatchLocalAction(action);
    return;
  }

  publishAppMenuCommand(action as AppMenuCommand);
}
