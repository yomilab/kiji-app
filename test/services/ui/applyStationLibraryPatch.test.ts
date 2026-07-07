import { describe, expect, it } from 'vitest';
import {
  applyStationLibraryPatchToExpandedStations,
  applyStationLibraryPatchToTags,
  type StationLibraryPatch,
} from '@/services/ui/applyStationLibraryPatch';
import type { Tag } from '@/types/tag';

const communityStation: Tag = {
  name: 'Community',
  feedIds: ['feed-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  sortOrder: 0,
};

const entrepreneurPatch: StationLibraryPatch = {
  previousName: 'Community',
  station: {
    name: 'Entrepreneur',
    feedIds: ['feed-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    sortOrder: 0,
  },
};

describe('applyStationLibraryPatchToTags', () => {
  it('renames a station in place', () => {
    const nextTags = applyStationLibraryPatchToTags([communityStation], entrepreneurPatch);

    expect(nextTags).toHaveLength(1);
    expect(nextTags[0]?.name).toBe('Entrepreneur');
  });

  it('does not append a duplicate when the rename patch is re-applied', () => {
    const renamedTags = applyStationLibraryPatchToTags([communityStation], entrepreneurPatch);
    const nextTags = applyStationLibraryPatchToTags(renamedTags, entrepreneurPatch);

    expect(nextTags).toHaveLength(1);
    expect(nextTags[0]?.name).toBe('Entrepreneur');
  });

  it('updates the existing row when only the renamed station remains', () => {
    const renamedTags = applyStationLibraryPatchToTags([communityStation], entrepreneurPatch);
    const nextTags = applyStationLibraryPatchToTags(renamedTags, {
      ...entrepreneurPatch,
      station: {
        ...entrepreneurPatch.station,
        feedIds: ['feed-1', 'feed-2'],
      },
    });

    expect(nextTags).toHaveLength(1);
    expect(nextTags[0]?.name).toBe('Entrepreneur');
    expect(nextTags[0]?.feedIds).toEqual(['feed-1', 'feed-2']);
  });

  it('appends a genuinely new station when no row matches', () => {
    const nextTags = applyStationLibraryPatchToTags([], {
      previousName: 'New Station',
      station: {
        name: 'New Station',
        feedIds: [],
        createdAt: '2026-02-01T00:00:00.000Z',
        sortOrder: 1,
      },
    });

    expect(nextTags).toHaveLength(1);
    expect(nextTags[0]?.name).toBe('New Station');
  });
});

describe('applyStationLibraryPatchToExpandedStations', () => {
  it('migrates expanded keys after a rename', () => {
    const result = applyStationLibraryPatchToExpandedStations(
      new Set(['Community']),
      entrepreneurPatch,
    );

    expect(result.expandedStations).toEqual(new Set(['Entrepreneur']));
    expect(result.shouldRefreshExpandedFeeds).toBe(true);
  });

  it('leaves unrelated expanded keys unchanged when the rename patch is re-applied', () => {
    const expanded = new Set(['Entrepreneur']);
    const result = applyStationLibraryPatchToExpandedStations(expanded, entrepreneurPatch);

    expect(result.expandedStations).toEqual(expanded);
    expect(result.shouldRefreshExpandedFeeds).toBe(true);
  });
});
