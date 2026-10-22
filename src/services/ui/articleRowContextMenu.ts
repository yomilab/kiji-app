import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { logger } from '@/services/logger';

export const ARTICLE_ROW_TOGGLE_READ_MENU_ID = 'article-row-toggle-read';

export const articleRowReadMenuLabel = (read: boolean): string =>
  (read ? 'Mark as Unread' : 'Mark as Read');

export const isNativeContextMenuAvailable = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Only the last popped-up menu is kept: its item action can still arrive
// after `popup()` resolves, so it is released when the next menu replaces it.
let activeMenuResources: Array<{ close: () => Promise<void> }> = [];

const releaseActiveMenu = (): void => {
  const resources = activeMenuResources;
  activeMenuResources = [];
  for (const resource of resources) {
    void resource.close().catch(() => {});
  }
};

/** Native row menu for the article list (same macOS menu as the app's other context menus). */
export async function showArticleRowContextMenu(options: {
  read: boolean;
  onToggleRead: () => void;
}): Promise<boolean> {
  if (!isNativeContextMenuAvailable()) return false;

  try {
    const toggleItem = await MenuItem.new({
      id: ARTICLE_ROW_TOGGLE_READ_MENU_ID,
      text: articleRowReadMenuLabel(options.read),
      action: () => options.onToggleRead(),
    });
    const menu = await Menu.new({ items: [toggleItem] });
    releaseActiveMenu();
    activeMenuResources = [menu, toggleItem];
    await menu.popup();
    return true;
  } catch (error) {
    logger.warn('ArticleRowContextMenu', 'Failed to show the article row menu', { error });
    return false;
  }
}
