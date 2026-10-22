import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommandPaletteCatalog } from '@/components/CommandPalette/commandPaletteModel';

const navigation = {
  selectFeed: vi.fn(async () => {}),
  selectTag: vi.fn(async () => {}),
  selectSmartView: vi.fn(async () => {}),
  selectedSmartView: null as string | null,
};
const overlay = {
  articleViewOverlayPhase: 'closed' as 'closed' | 'open',
  isArticleClosing: false,
  requestCloseArticle: vi.fn(),
};
const refreshFeed = vi.fn(async () => {});
const setTheme = vi.fn();
const callOrder: string[] = [];

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => navigation,
  useFeedOverlay: () => overlay,
  useFeedCollectionActions: () => ({ refreshFeed }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}));

const catalog: CommandPaletteCatalog = {
  smartViews: [{ id: 'unread', visible: true }],
  stations: [{ name: 'Design', feedIds: ['feed-design'], sortOrder: 0 }],
  feeds: [
    { id: 'feed-design', title: 'Design Systems Weekly', url: 'https://example.com/design.xml', tags: ['Design'] },
    { id: 'feed-world', title: 'World Briefing', url: 'https://example.com/world.xml', tags: [] },
  ],
};

vi.mock('@/components/CommandPalette/commandPaletteCatalog', () => ({
  peekCommandPaletteCatalog: () => catalog,
  loadCommandPaletteCatalog: async () => catalog,
}));

vi.mock('@/services/favicons/sidebarFaviconCache', () => ({
  needsSidebarFavicon: () => false,
  hydrateSidebarFavicons: async () => new Map(),
  applySidebarFavicons: (rows: unknown[]) => rows,
}));

vi.mock('@/services/ui/openManageFeedsWindow', () => ({ openManageFeedsWindow: vi.fn(async () => {}) }));
vi.mock('@/services/ui/openSettingsWindow', () => ({ openSettingsWindow: vi.fn(async () => {}) }));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { CommandPaletteHost } from '@/components/CommandPalette/CommandPaletteHost';
import { COMMAND_PALETTE_RECENT_STORAGE_KEY } from '@/components/CommandPalette/commandPaletteModel';
import { isOpenCommandPaletteShortcut } from '@/services/shortcuts/shortcutService';
import { subscribeArticleViewCommand } from '@/services/ui/articleViewCommandBus';

const pressKey = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
  act(() => {
    fireEvent.keyDown(target, { key, bubbles: true, ...init });
  });
};

const openPalette = (init: KeyboardEventInit = { metaKey: true }) => pressKey('k', init, document.body);

const palette = () => document.querySelector('[data-component="command-palette"]');
const rowKeys = () => Array.from(document.querySelectorAll('[data-component="command-palette-row"]'))
  .map((row) => row.getAttribute('data-entry-key'));
const activeKey = () => document.querySelector('.command-palette-row.is-active')?.getAttribute('data-entry-key');

const typeQuery = (value: string) => {
  const input = screen.getByRole('combobox');
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
};

describe('CommandPaletteHost', () => {
  beforeEach(() => {
    overlay.articleViewOverlayPhase = 'closed';
    navigation.selectedSmartView = null;
    callOrder.length = 0;
    overlay.requestCloseArticle.mockImplementation(() => { callOrder.push('close'); });
    navigation.selectFeed.mockImplementation(async () => { callOrder.push('selectFeed'); });
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
  });

  it('matches ⌘K and Ctrl+K but not ⇧⌘K', () => {
    const event = (init: Partial<KeyboardEvent>) => ({
      key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init,
    });
    expect(isOpenCommandPaletteShortcut(event({ metaKey: true }))).toBe(true);
    expect(isOpenCommandPaletteShortcut(event({ ctrlKey: true }))).toBe(true);
    expect(isOpenCommandPaletteShortcut(event({ metaKey: true, shiftKey: true, key: 'K' }))).toBe(false);
    expect(isOpenCommandPaletteShortcut(event({}))).toBe(false);
  });

  it('opens on ⌘K, closes on Esc and returns focus', async () => {
    render(
      <>
        <button type="button">Before</button>
        <CommandPaletteHost />
      </>,
    );
    const before = screen.getByText('Before');
    before.focus();

    openPalette();
    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));

    pressKey('Escape');
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(before);

    openPalette({ ctrlKey: true });
    expect(palette()).not.toBeNull();
    pressKey('k', { metaKey: true });
    expect(palette()).toBeNull();
  });

  it('does not open while typing in another field or over the Add Feeds modal', () => {
    render(
      <>
        <input aria-label="Other field" />
        <CommandPaletteHost />
      </>,
    );
    const field = screen.getByLabelText('Other field');
    field.focus();
    pressKey('k', { metaKey: true }, field);
    expect(palette()).toBeNull();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    openPalette();
    expect(palette()).toBeNull();

    backdrop.remove();
    pressKey('k', { metaKey: true, shiftKey: true }, document.body);
    expect(palette()).toBeNull();
  });

  it('keeps other shortcuts quiet while open', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    render(<CommandPaletteHost />);
    openPalette();
    behind.mockClear();
    pressKey('j', {}, screen.getByRole('combobox'));
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener('keydown', behind);
  });

  it('filters, moves with arrows and picks a feed through selectFeed after closing the article', async () => {
    overlay.articleViewOverlayPhase = 'open';
    render(<CommandPaletteHost />);
    openPalette();

    typeQuery('w');
    expect(rowKeys()[0]).toBe('feed:feed-world');
    typeQuery('design');
    expect(rowKeys()).toEqual(['station:Design', 'feed:feed-design']);
    expect(activeKey()).toBe('station:Design');

    pressKey('ArrowDown');
    expect(activeKey()).toBe('feed:feed-design');
    pressKey('ArrowDown');
    expect(activeKey()).toBe('feed:feed-design');
    pressKey('ArrowUp');
    pressKey('ArrowDown');
    pressKey('Enter');

    expect(palette()).toBeNull();
    expect(navigation.selectFeed).toHaveBeenCalledWith(
      'feed-design',
      'https://example.com/design.xml',
      'Design Systems Weekly',
      undefined,
    );
    expect(callOrder).toEqual(['close', 'selectFeed']);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(COMMAND_PALETTE_RECENT_STORAGE_KEY) ?? '[]')).toEqual(['feed:feed-design']);
    });
  });

  it('picks stations and unstationed feeds the way the sidebar does, and ranks the last pick first', () => {
    render(<CommandPaletteHost />);
    openPalette();
    typeQuery('design');
    pressKey('Enter');
    expect(navigation.selectTag).toHaveBeenCalledWith('Design', {}, ['feed-design']);
    expect(overlay.requestCloseArticle).not.toHaveBeenCalled();

    openPalette();
    typeQuery('world');
    pressKey('Enter');
    expect(navigation.selectFeed).toHaveBeenCalledWith(
      'feed-world',
      'https://example.com/world.xml',
      'World Briefing',
      { forceNetwork: true },
    );

    openPalette();
    expect(rowKeys().slice(0, 2)).toEqual(['feed:feed-world', 'station:Design']);
  });

  it('offers reader mode only over an open article and sends it to the article view', () => {
    const received: string[] = [];
    const unsubscribe = subscribeArticleViewCommand((command) => received.push(command));
    render(<CommandPaletteHost />);
    openPalette();
    typeQuery('reader');
    expect(rowKeys()).toEqual([]);
    pressKey('Escape');
    cleanup();

    overlay.articleViewOverlayPhase = 'open';
    render(<CommandPaletteHost />);
    openPalette();
    typeQuery('reader');
    expect(rowKeys()).toEqual(['action:toggle-reader-mode']);
    pressKey('Enter');
    expect(received).toEqual(['toggleReaderMode']);
    expect(overlay.requestCloseArticle).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('runs actions', () => {
    render(<CommandPaletteHost />);
    openPalette();
    typeQuery('refresh');
    pressKey('Enter');
    expect(refreshFeed).toHaveBeenCalledTimes(1);

    openPalette();
    typeQuery('theme dark');
    pressKey('Enter');
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
