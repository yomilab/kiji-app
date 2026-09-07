import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsManager } from '@/services/settings';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { feedsManager } from '@/services/feeds/feedsManager';
import {
  mergeSmartViewOrderFromVisible,
  persistNestedMembershipOrder,
  persistSmartViewOrder,
  persistStationOrder,
  persistUnstationedOrder,
} from '@/services/feeds/libraryOrderPersist';

vi.mock('@/services/settings', () => ({
  settingsManager: {
    getSmartViews: vi.fn(),
    setSmartViews: vi.fn(),
  },
}));

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    reorderStations: vi.fn(),
    reorderMembership: vi.fn(),
    getAllTags: vi.fn(),
  },
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    reorderUnstationed: vi.fn(),
    getAllFeeds: vi.fn(),
  },
}));

describe('mergeSmartViewOrderFromVisible', () => {
  it('does not unhide or drop views when the visible count mismatches', () => {
    const next = mergeSmartViewOrderFromVisible(
      ['saved', 'all', 'today'],
      [
        { id: 'all', visible: true, sortOrder: 0 },
        { id: 'unread', visible: false, sortOrder: 1 },
        { id: 'today', visible: true, sortOrder: 2 },
      ],
    );

    expect(next).toEqual([
      { id: 'all', visible: true, sortOrder: 0 },
      { id: 'unread', visible: false, sortOrder: 1 },
      { id: 'today', visible: true, sortOrder: 2 },
    ]);
  });

  it('rewrites only visible slots and keeps hidden views hidden', () => {
    const next = mergeSmartViewOrderFromVisible(
      ['saved', 'all', 'today'],
      [
        { id: 'all', visible: true, sortOrder: 0 },
        { id: 'unread', visible: false, sortOrder: 1 },
        { id: 'today', visible: true, sortOrder: 2 },
        { id: 'saved', visible: true, sortOrder: 3 },
      ],
    );

    expect(next).toEqual([
      { id: 'saved', visible: true, sortOrder: 0 },
      { id: 'unread', visible: false, sortOrder: 1 },
      { id: 'all', visible: true, sortOrder: 2 },
      { id: 'today', visible: true, sortOrder: 3 },
    ]);
  });
});

describe('library order persist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tagsManager.reorderStations).mockResolvedValue(undefined);
    vi.mocked(tagsManager.reorderMembership).mockResolvedValue(undefined);
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([]);
    vi.mocked(feedsManager.reorderUnstationed).mockResolvedValue(undefined);
    vi.mocked(settingsManager.setSmartViews).mockResolvedValue(undefined);
    vi.mocked(settingsManager.getSmartViews).mockResolvedValue([
      { id: 'all', visible: true, sortOrder: 0 },
      { id: 'unread', visible: true, sortOrder: 1 },
    ]);
  });

  it('publishes stationsReordered only after batch IPC', async () => {
    const order: string[] = [];
    vi.mocked(tagsManager.reorderStations).mockImplementation(async () => {
      order.push('ipc');
    });
    const publish = vi.spyOn(feedLibraryMutationBus, 'publishStationsReordered')
      .mockImplementation(() => {
        order.push('bus');
      });

    await persistStationOrder(['Beta', 'Alpha']);

    expect(tagsManager.reorderStations).toHaveBeenCalledWith(['Beta', 'Alpha']);
    expect(publish).toHaveBeenCalledWith([
      { name: 'Beta', sortOrder: 0 },
      { name: 'Alpha', sortOrder: 1 },
    ]);
    expect(order).toEqual(['ipc', 'bus']);
  });

  it('publishes membership reorder only after batch IPC', async () => {
    const order: string[] = [];
    vi.mocked(tagsManager.reorderMembership).mockImplementation(async () => {
      order.push('ipc');
    });
    const publish = vi.spyOn(feedLibraryMutationBus, 'publishStationMembershipReordered')
      .mockImplementation(() => {
        order.push('bus');
      });

    await persistNestedMembershipOrder('Daily', ['b', 'a']);

    expect(tagsManager.reorderMembership).toHaveBeenCalledWith('Daily', ['b', 'a']);
    expect(publish).toHaveBeenCalledWith({ stationName: 'Daily', feedIds: ['b', 'a'] });
    expect(order).toEqual(['ipc', 'bus']);
  });

  it('re-reads membership so a concurrent attach is not dropped', async () => {
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([
      {
        name: 'Daily',
        feedIds: ['a', 'attached', 'b'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await persistNestedMembershipOrder('Daily', ['b', 'a']);

    expect(tagsManager.reorderMembership).toHaveBeenCalledWith('Daily', ['b', 'attached', 'a']);
  });

  it('publishes unstationed reorder only after batch IPC', async () => {
    const order: string[] = [];
    vi.mocked(feedsManager.reorderUnstationed).mockImplementation(async () => {
      order.push('ipc');
    });
    const publish = vi.spyOn(feedLibraryMutationBus, 'publishUnstationedReordered')
      .mockImplementation(() => {
        order.push('bus');
      });

    await persistUnstationedOrder(['feed-2', 'feed-1']);

    expect(feedsManager.reorderUnstationed).toHaveBeenCalledWith(['feed-2', 'feed-1']);
    expect(publish).toHaveBeenCalledWith([
      { id: 'feed-2', sortOrder: 0 },
      { id: 'feed-1', sortOrder: 1 },
    ]);
    expect(order).toEqual(['ipc', 'bus']);
  });

  it('publishes smartViewsPatched only after settings write', async () => {
    const order: string[] = [];
    vi.mocked(settingsManager.setSmartViews).mockImplementation(async () => {
      order.push('ipc');
    });
    const publish = vi.spyOn(feedLibraryMutationBus, 'publishSmartViewsPatched')
      .mockImplementation(() => {
        order.push('bus');
      });

    await persistSmartViewOrder(['unread', 'all']);

    expect(settingsManager.setSmartViews).toHaveBeenCalled();
    expect(publish).toHaveBeenCalled();
    expect(order).toEqual(['ipc', 'bus']);
  });
});
