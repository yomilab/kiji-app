import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    emitTo: vi.fn(async () => {}),
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return () => {
        listeners.delete(name);
      };
    }),
    closeWindow: vi.fn(async () => {}),
    setTitle: vi.fn(async () => {}),
    listSidebarSnapshot: vi.fn(),
    getFavicons: vi.fn(async () => []),
    getSmartViews: vi.fn(async () => []),
    setSmartViews: vi.fn(async () => {}),
    deleteFeeds: vi.fn(async (ids: string[]) => ids.length),
    updateFeed: vi.fn(),
    getFeedByUrl: vi.fn(async () => null),
    getAllTags: vi.fn(),
    addTagToFeed: vi.fn(async () => {}),
    removeTagFromFeed: vi.fn(async () => {}),
    deleteTag: vi.fn(async () => {}),
    renameTag: vi.fn(async () => {}),
    saveTag: vi.fn(async () => {}),
    updateTag: vi.fn(),
    reorderStations: vi.fn(async () => {}),
    toastShow: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/event', () => ({ emitTo: mocks.emitTo, listen: mocks.listen }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: mocks.closeWindow, setTitle: mocks.setTitle, startDragging: vi.fn(), toggleMaximize: vi.fn() }),
}));
vi.mock('@/hooks/useSystemAccentColor', () => ({ useSystemAccentColor: () => undefined }));
vi.mock('@/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/feedStore', () => ({
  listSidebarSnapshot: mocks.listSidebarSnapshot,
  getFavicons: mocks.getFavicons,
}));
vi.mock('@/services/settings', () => ({
  settingsManager: { getSmartViews: mocks.getSmartViews, setSmartViews: mocks.setSmartViews },
}));
vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    deleteFeeds: mocks.deleteFeeds,
    updateFeed: mocks.updateFeed,
    getFeedByUrl: mocks.getFeedByUrl,
    reorderUnstationed: vi.fn(async () => {}),
  },
}));
vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    getAllTags: mocks.getAllTags,
    addTagToFeed: mocks.addTagToFeed,
    removeTagFromFeed: mocks.removeTagFromFeed,
    deleteTag: mocks.deleteTag,
    renameTag: mocks.renameTag,
    saveTag: mocks.saveTag,
    updateTag: mocks.updateTag,
    reorderStations: mocks.reorderStations,
    reorderMembership: vi.fn(async () => {}),
  },
}));
vi.mock('@/services/ui/appToastService', () => ({
  APP_TOAST_CHANNEL: 'app-toast',
  appToastService: { show: mocks.toastShow },
}));
vi.mock('@/components/common/EmojiPicker/EmojiSubmenu', () => ({
  EmojiSubmenu: ({ isOpen, onEmojiSelect }: { isOpen: boolean; onEmojiSelect: (emoji: string) => void }) => (
    isOpen ? <button type="button" className="emoji-submenu" onClick={() => onEmojiSelect('🚀')}>Pick rocket</button> : null
  ),
}));

const baseFeeds = () => [
  {
    id: 'feed-only-news',
    title: 'Only News',
    url: 'https://one.test/rss',
    tags: ['News'],
    articleCount: 12,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    lastFetched: new Date(),
  },
  {
    id: 'feed-shared',
    title: 'Shared',
    url: 'https://two.test/rss',
    tags: ['News', 'Tech'],
    articleCount: 4,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    consecutiveFailures: 2,
  },
  {
    id: 'feed-loose',
    title: 'Loose Ends',
    url: 'https://www.loose.test/feed.xml',
    tags: [],
    articleCount: 0,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  },
];
const baseStations = () => [
  { name: 'News', feedIds: ['feed-only-news', 'feed-shared'], createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 0 },
  { name: 'Tech', feedIds: ['feed-shared'], createdAt: '2026-01-01T00:00:00.000Z', sortOrder: 1 },
];

const loadModules = async () => {
  vi.resetModules();
  const { ManageFeedsWindow } = await import('@/components/ManageFeedsWindow/ManageFeedsWindow');
  const { feedLibraryMutationBus } = await import('@/services/ui/feedLibraryMutationBus');
  const { getRobustnessSnapshot } = await import('@/services/diagnostics/robustnessMetrics');
  return { ManageFeedsWindow, feedLibraryMutationBus, getRobustnessSnapshot };
};

const renderWindow = async (target: unknown = null) => {
  const modules = await loadModules();
  (window as unknown as { kijiAPI: unknown }).kijiAPI = {
    takeManageFeedsTarget: vi.fn(async () => target),
    runMainWindowCommand: vi.fn(async () => {}),
    saveOpmlFile: vi.fn(async () => ({ canceled: false })),
  };
  render(<modules.ManageFeedsWindow />);
  return modules;
};

const relayedKinds = () => mocks.emitTo.mock.calls
  .filter((call) => call[0] === 'main' && call[1] === 'feed-library:mutation')
  .map((call) => (call[2] as { message: { kind: string } }).message.kind);

describe('ManageFeedsWindow', () => {
  beforeEach(() => {
    mocks.listSidebarSnapshot.mockImplementation(async () => ({ feeds: baseFeeds(), stations: baseStations() }));
    mocks.getAllTags.mockImplementation(async () => baseStations());
    mocks.deleteTag.mockResolvedValue(undefined);
    mocks.deleteFeeds.mockImplementation(async (ids: string[]) => ids.length);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.listeners.clear();
  });

  it('shows separate tabs and lists feeds with site, stations, counts and status', async () => {
    await renderWindow();
    const nav = screen.getByRole('tablist', { name: 'Manage feeds' });
    expect(within(nav).getAllByRole('tab').map((tab) => tab.textContent?.trim()))
      .toEqual(['Feeds', 'Stations', 'Library', 'Import & Export']);
    expect(within(nav).getByRole('tab', { name: 'Feeds' })).toHaveAttribute('aria-selected', 'true');

    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    const rows = within(list).getAllByRole('option');
    expect(rows).toHaveLength(3);
    const shared = rows.find((row) => row.textContent?.includes('Shared'))!;
    expect(shared).toHaveTextContent('two.test');
    expect(shared).toHaveTextContent('News');
    expect(shared).toHaveTextContent('Tech');
    expect(shared).toHaveTextContent('Can’t update');
    expect(rows.find((row) => row.textContent?.includes('Loose Ends'))).toHaveTextContent('loose.test');
    expect(screen.getByText('3 feeds · 1 can’t update')).toBeInTheDocument();
    // A feed that can't update is reported in the list and subtitle, not as a dot on the tab.
    expect(nav.querySelector('.mf-tab-alert')).toBeNull();
    expect(within(nav).getByText('Feeds').parentElement?.querySelectorAll('span[class*="alert"]')).toHaveLength(0);

    fireEvent.click(within(nav).getByText('Stations'));
    expect(await screen.findByRole('list', { name: 'Stations' })).toBeInTheDocument();
    fireEvent.click(within(nav).getByText('Import & Export'));
    expect(screen.getByText('Export all feeds')).toBeInTheDocument();
  });

  it('puts the tabs in a top toolbar that follows arrow keys and titles the window', async () => {
    await renderWindow();
    await screen.findByRole('listbox', { name: 'Feeds' });
    const tablist = screen.getByRole('tablist', { name: 'Manage feeds' });
    // The toolbar sits above the pane, not in a sidebar.
    expect(tablist.closest('header')).toHaveClass('mf-titlebar');
    expect(document.querySelector('.settings-sidebar')).toBeNull();
    await waitFor(() => expect(mocks.setTitle).toHaveBeenLastCalledWith('Feeds'));

    const feedsTab = within(tablist).getByRole('tab', { name: 'Feeds' });
    feedsTab.focus();
    fireEvent.keyDown(feedsTab, { key: 'ArrowRight' });
    const stationsTab = within(tablist).getByRole('tab', { name: 'Stations' });
    expect(stationsTab).toHaveAttribute('aria-selected', 'true');
    expect(stationsTab).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'mf-tab-stations');
    await waitFor(() => expect(mocks.setTitle).toHaveBeenLastCalledWith('Stations'));

    fireEvent.keyDown(stationsTab, { key: 'ArrowLeft' });
    fireEvent.keyDown(within(tablist).getByRole('tab', { name: 'Feeds' }), { key: 'ArrowLeft' });
    expect(within(tablist).getByRole('tab', { name: 'Import & Export' })).toHaveAttribute('aria-selected', 'true');
    // Only the selected tab is in the Tab order.
    expect(within(tablist).getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it('filters to feeds that can’t update and searches by name', async () => {
    await renderWindow();
    await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(screen.getByRole('button', { name: /Can’t Update/ }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search feeds' }), { target: { value: 'loose' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((row) => row.dataset.feedId)).toEqual(['feed-loose']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search feeds' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No feeds match “zzz”')).toBeInTheDocument();
  });

  it('opens on the tab and row named by the sidebar target', async () => {
    await renderWindow({ kind: 'station', id: 'Tech' });
    const stations = await screen.findByRole('list', { name: 'Stations' });
    await waitFor(() => expect(within(stations).getByLabelText('Tech, 1 feed')).toHaveFocus());
  });

  it('bulk deletes the selected feeds in one call and relays each delete to the main window', async () => {
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(within(list).getByLabelText('Select Only News'));
    fireEvent.click(within(list).getByLabelText('Select Loose Ends'));
    const bar = screen.getByRole('toolbar', { name: 'Selected feeds' });
    expect(bar).toHaveTextContent('2 feeds selected');

    fireEvent.click(within(bar).getByText('Delete…'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 feeds?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
    expect(mocks.deleteFeeds).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFeeds).toHaveBeenCalledWith(['feed-only-news', 'feed-loose']);
    expect(relayedKinds().filter((kind) => kind === 'feedDeleted')).toHaveLength(2);
    expect(screen.queryByRole('toolbar', { name: 'Selected feeds' })).toBeNull();
  });

  it('applies changes made in the main window to its lists', async () => {
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    const deliver = mocks.listeners.get('feed-library:mutation');
    expect(deliver).toBeDefined();
    act(() => {
      deliver!({ payload: { source: 'main', message: { kind: 'feedDeleted', feedId: 'feed-loose' } } });
      deliver!({ payload: { source: 'main', message: { kind: 'feedPatched', feedId: 'feed-shared', changes: { title: 'Shared Renamed' } } } });
    });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    expect(within(list).getByText('Shared Renamed')).toBeInTheDocument();
    // Remote changes are not echoed back.
    expect(relayedKinds()).toEqual([]);
  });

  it('reloads status after a refresh cycle finishes in the main window', async () => {
    await renderWindow();
    await screen.findByRole('listbox', { name: 'Feeds' });
    mocks.listSidebarSnapshot.mockImplementation(async () => ({
      feeds: baseFeeds().map((feed) => ({ ...feed, consecutiveFailures: 0 })),
      stations: baseStations(),
    }));
    await act(async () => {
      mocks.listeners.get('feed-library:status-changed')?.({ payload: null });
    });
    await waitFor(() => expect(screen.queryByText('Can’t update')).toBeNull());
  });

  it('edits a feed name, emoji and stations from the editor sheet', async () => {
    mocks.updateFeed.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({ ...baseFeeds().find((feed) => feed.id === id), ...updates }));
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(within(list).getByLabelText('Edit Loose Ends'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Feed' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Loose Threads' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose an emoji' }));
    fireEvent.click(screen.getByText('Pick rocket'));
    fireEvent.click(within(dialog).getByLabelText('Tech'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.updateFeed).toHaveBeenCalledWith('feed-loose', { title: 'Loose Threads', emoji: '🚀' });
    expect(mocks.addTagToFeed).toHaveBeenCalledWith('feed-loose', 'Tech');
    expect(within(list).getByText('Loose Threads')).toBeInTheDocument();
    expect(relayedKinds()).toEqual(expect.arrayContaining(['feedPatched', 'stationPatched']));
  });

  it('rejects a feed address that is already followed, in plain language', async () => {
    mocks.getFeedByUrl.mockResolvedValueOnce({ id: 'feed-shared' });
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(within(list).getByLabelText('Edit Loose Ends'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Feed' });
    fireEvent.change(within(dialog).getByLabelText('Feed address'), { target: { value: 'https://two.test/rss' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(mocks.toastShow).toHaveBeenCalledWith('You already follow a feed at this address.');
    expect(mocks.updateFeed).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit Feed' })).toBeInTheDocument();
  });

  it('adds selected feeds to a station from the bulk bar', async () => {
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(within(list).getByLabelText('Select Only News'));
    fireEvent.click(within(list).getByLabelText('Select Loose Ends'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Station' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Tech' }));
    });
    await waitFor(() => expect(mocks.addTagToFeed).toHaveBeenCalledTimes(2));
    expect(mocks.addTagToFeed).toHaveBeenNthCalledWith(1, 'feed-only-news', 'Tech');
    expect(mocks.addTagToFeed).toHaveBeenNthCalledWith(2, 'feed-loose', 'Tech');
  });

  it('publishes the committed feed deletion even when the station delete fails', async () => {
    mocks.deleteTag.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));
    const { feedLibraryMutationBus, getRobustnessSnapshot } = await renderWindow({ kind: 'station', id: 'News' });
    const publishFeedDeleted = vi.spyOn(feedLibraryMutationBus, 'publishFeedDeleted');
    const publishStationPatched = vi.spyOn(feedLibraryMutationBus, 'publishStationPatched');
    const publishStationDeleted = vi.spyOn(feedLibraryMutationBus, 'publishStationDeleted');

    fireEvent.click(await screen.findByLabelText('Delete station News'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “News”?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Station and Feeds' }));
    });

    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith(
      'The feeds were deleted, but the station couldn’t be removed. Try again.',
    ));
    expect(mocks.deleteFeeds).toHaveBeenCalledWith(['feed-only-news']);
    expect(publishFeedDeleted).toHaveBeenCalledWith('feed-only-news');
    expect(publishStationDeleted).not.toHaveBeenCalled();
    expect(publishStationPatched).toHaveBeenCalledWith('News', expect.objectContaining({
      name: 'News',
      feedIds: ['feed-shared'],
    }));
    expect(getRobustnessSnapshot().counters['ui.deleteFlowPartialFailure']).toBe(1);
    // No raw database text reaches the user.
    expect(mocks.toastShow.mock.calls.flat().join(' ')).not.toMatch(/SQLITE|locked/);
  });

  it('deletes a station and its only-here feeds on success', async () => {
    const { feedLibraryMutationBus } = await renderWindow({ kind: 'station', id: 'News' });
    const publishStationDeleted = vi.spyOn(feedLibraryMutationBus, 'publishStationDeleted');
    fireEvent.click(await screen.findByLabelText('Delete station News'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “News”?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Station and Feeds' }));
    });
    await waitFor(() => expect(publishStationDeleted).toHaveBeenCalledWith('News', ['feed-only-news', 'feed-shared']));
    expect(mocks.toastShow).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Delete station News')).toBeNull();
  });

  it('creates a station and renames it inline', async () => {
    mocks.getAllTags.mockImplementation(async () => [...baseStations(), { name: 'New Station', feedIds: [], createdAt: 'x', sortOrder: 2 }]);
    await renderWindow({ kind: 'station', id: 'News' });
    await screen.findByRole('list', { name: 'Stations' });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'New Station' })[0]);
    });
    expect(mocks.saveTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Station', feedIds: [], sortOrder: 2 }));
    const input = await screen.findByRole('textbox', { name: 'Station name' });
    fireEvent.change(input, { target: { value: 'Design' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(mocks.renameTag).toHaveBeenCalledWith('New Station', 'Design');
    expect(await screen.findByText('Design')).toBeInTheDocument();
  });

  it('moves a station with Option-Down', async () => {
    await renderWindow({ kind: 'station', id: 'News' });
    const row = await screen.findByLabelText('News, 2 feeds');
    await waitFor(() => expect(row).toHaveFocus());
    await act(async () => {
      fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
    });
    expect(mocks.reorderStations).toHaveBeenCalledWith(['Tech', 'News']);
    await waitFor(() => {
      const names = within(screen.getByRole('list', { name: 'Stations' })).getAllByRole('listitem')
        .map((item) => item.getAttribute('data-station-name'));
      expect(names).toEqual(['Tech', 'News']);
    });
  });

  it('hides a Library item from the sidebar', async () => {
    await renderWindow({ kind: 'smart-view', id: 'saved' });
    const toggle = await screen.findByRole('switch', { name: 'Show Saved in the sidebar' });
    const summary = document.querySelector('.mf-pane-summary');
    expect(summary?.textContent).toMatch(/^\d+ views · \d+ shown$/);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(mocks.setSmartViews).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'saved', visible: false }),
    ]));
    expect(relayedKinds()).toContain('smartViewsPatched');
  });

  it('sends Add Feed and Import to the main window', async () => {
    await renderWindow();
    await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Feed…' }));
    const api = (window as unknown as { kijiAPI: { runMainWindowCommand: ReturnType<typeof vi.fn> } }).kijiAPI;
    expect(api.runMainWindowCommand).toHaveBeenCalledWith({ type: 'openAddSubscription' });
    fireEvent.click(screen.getByRole('tab', { name: 'Import & Export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import…' }));
    expect(api.runMainWindowCommand).toHaveBeenCalledWith({ type: 'importFeeds' });
  });

  it('Esc closes a sheet first, then the window', async () => {
    await renderWindow();
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    fireEvent.click(within(list).getByLabelText('Edit Shared'));
    await screen.findByRole('dialog', { name: 'Edit Feed' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.closeWindow).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mocks.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard selection and delete in the feed list', async () => {
    await renderWindow({ kind: 'feed', id: 'feed-only-news' });
    const list = await screen.findByRole('listbox', { name: 'Feeds' });
    const first = within(list).getAllByRole('option')[0];
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });
    expect(within(list).getAllByRole('option').filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    fireEvent.keyDown(within(list).getAllByRole('option')[1], { key: 'Backspace' });
    expect(await screen.findByRole('dialog', { name: 'Delete 2 feeds?' })).toBeInTheDocument();
  });
});
