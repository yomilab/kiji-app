import { describe, expect, it } from 'vitest';
import {
  buildWindowsAppMenuTree,
  isInAppMenuBarOs,
} from '@/services/ui/appMenuModel';

const FILE_APP_CLUSTER_IDS = ['about', 'check-updates', 'settings', 'quit'] as const;

describe('appMenuModel', () => {
  it('builds Windows Reader/File/View/Subscriptions/Help top-level menus', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: null });
    expect(tree.map((menu) => menu.id)).toEqual([
      'kiji',
      'file',
      'view',
      'subscriptions',
      'help',
    ]);
    expect(tree[0]?.label).toBe('Reader');
    expect(tree[0]?.accessKey).toBe('k');
  });

  it('lists Manage Feeds under Subscriptions with its shortcut', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: null });
    const subscriptions = tree.find((menu) => menu.id === 'subscriptions');
    const manage = subscriptions?.items.find((item) => item.kind === 'item' && item.id === 'manage-feeds');
    expect(manage).toMatchObject({
      label: 'Manage Feeds...',
      action: { type: 'openManageFeeds' },
      shortcutHint: 'Ctrl+E',
    });
  });

  it('lists article text size commands at the top of View', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: null });
    const view = tree.find((menu) => menu.id === 'view');
    expect(view?.items.slice(0, 3)).toEqual([
      expect.objectContaining({ label: 'Make Text Bigger', action: { type: 'readerTextSize', action: 'bigger' }, shortcutHint: 'Ctrl++' }),
      expect.objectContaining({ label: 'Make Text Smaller', action: { type: 'readerTextSize', action: 'smaller' }, shortcutHint: 'Ctrl+-' }),
      expect.objectContaining({ label: 'Actual Text Size', action: { type: 'readerTextSize', action: 'reset' }, shortcutHint: 'Ctrl+0' }),
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

  it('marks the Read library item when that view is selected', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: 'read' });
    const view = tree.find((menu) => menu.id === 'view');
    const library = view?.items.find(
      (item) => item.kind === 'submenu' && item.id === 'library',
    );
    if (library?.kind !== 'submenu') {
      throw new Error('expected library submenu');
    }

    expect(library.children.map((item) => item.kind === 'item' && item.id)).toEqual([
      'library-saved',
      'library-unread',
      'library-all',
      'library-read',
    ]);
    const read = library.children.find(
      (item) => item.kind === 'item' && item.id === 'library-read',
    );
    const unread = library.children.find(
      (item) => item.kind === 'item' && item.id === 'library-unread',
    );
    expect(read?.kind === 'item' && read.checked).toBe(true);
    expect(unread?.kind === 'item' && unread.checked).toBe(false);
  });

  it('enables in-app menu bar on Windows/Linux/other only', () => {
    expect(isInAppMenuBarOs('windows')).toBe(true);
    expect(isInAppMenuBarOs('linux')).toBe(true);
    expect(isInAppMenuBarOs('other')).toBe(true);
    expect(isInAppMenuBarOs('macos')).toBe(false);
  });

  it('groups About KiJi Reader and Check for Updates above Settings in Reader', () => {
    const tree = buildWindowsAppMenuTree({ theme: 'auto', libraryView: null });
    const kiji = tree.find((menu) => menu.id === 'kiji');
    expect(kiji).toBeDefined();
    const ids = kiji?.items.map((item) => item.id) ?? [];
    expect(ids).toEqual([
      'about',
      'check-updates',
      'kiji-sep-app',
      'settings',
      'kiji-sep-quit',
      'quit',
    ]);

    const about = kiji?.items.find((item) => item.kind === 'item' && item.id === 'about');
    const checkUpdates = kiji?.items.find(
      (item) => item.kind === 'item' && item.id === 'check-updates',
    );
    expect(about?.kind === 'item' && about.label).toBe('About KiJi Reader');
    expect(checkUpdates?.kind === 'item' && checkUpdates.label).toBe('Check for Updates');
    const quit = kiji?.items.find((item) => item.kind === 'item' && item.id === 'quit');
    expect(quit?.kind === 'item' && quit.label).toBe('Quit Reader');

    const file = tree.find((menu) => menu.id === 'file');
    const fileIds = file?.items.map((item) => item.id) ?? [];
    for (const id of FILE_APP_CLUSTER_IDS) {
      expect(fileIds).not.toContain(id);
    }

    const help = tree.find((menu) => menu.id === 'help');
    expect(help?.items.some((item) => item.id === 'about')).toBe(false);
  });

  it('renames Check for Updates to Update KiJi Reader when an update is available', () => {
    const tree = buildWindowsAppMenuTree({
      theme: 'auto',
      libraryView: null,
      updateAvailable: true,
    });
    const kiji = tree.find((menu) => menu.id === 'kiji');
    const checkUpdates = kiji?.items.find(
      (item) => item.kind === 'item' && item.id === 'check-updates',
    );
    expect(checkUpdates?.kind === 'item' && checkUpdates.label).toBe('Update KiJi Reader');

    const file = tree.find((menu) => menu.id === 'file');
    expect(file?.items.some((item) => item.id === 'check-updates')).toBe(false);
  });
});
