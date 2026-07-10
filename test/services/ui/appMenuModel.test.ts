import { describe, expect, it } from 'vitest';
import {
  buildWindowsAppMenuTree,
  isInAppMenuBarOs,
} from '@/services/ui/appMenuModel';

describe('appMenuModel', () => {
  it('builds Windows File/View/Subscriptions/Help top-level menus', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: null });
    expect(tree.map((menu) => menu.id)).toEqual([
      'file',
      'view',
      'subscriptions',
      'help',
    ]);
  });

  it('marks theme and library check items from state', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'dark', libraryView: 'unread' });
    const view = tree.find((menu) => menu.id === 'view');
    expect(view).toBeDefined();
    const theme = view?.items.find(
      (item) => item.kind === 'submenu' && item.id === 'theme',
    );
    const library = view?.items.find(
      (item) => item.kind === 'submenu' && item.id === 'library',
    );
    expect(theme?.kind).toBe('submenu');
    expect(library?.kind).toBe('submenu');
    if (theme?.kind !== 'submenu' || library?.kind !== 'submenu') {
      throw new Error('expected theme and library submenus');
    }

    const dark = theme.children.find((item) => item.kind === 'item' && item.id === 'theme-dark');
    const unread = library.children.find(
      (item) => item.kind === 'item' && item.id === 'library-unread',
    );
    expect(dark?.kind === 'item' && dark.checked).toBe(true);
    expect(unread?.kind === 'item' && unread.checked).toBe(true);
  });

  it('enables in-app menu bar on Windows/Linux/other only', () => {
    expect(isInAppMenuBarOs('windows')).toBe(true);
    expect(isInAppMenuBarOs('linux')).toBe(true);
    expect(isInAppMenuBarOs('other')).toBe(true);
    expect(isInAppMenuBarOs('macos')).toBe(false);
  });
});
