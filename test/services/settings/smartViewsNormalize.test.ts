import { describe, expect, it } from 'vitest';
import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';
import { normalizeSmartViews } from '@/services/settings/settingsManager';
import { buildLibraryItems } from '@/components/ManageFeedsWindow/manageFeedsModel';

describe('normalizeSmartViews', () => {
  it('appends a visible Read row for existing Saved/Unread/All prefs', () => {
    const merged = normalizeSmartViews([
      { id: 'saved', visible: true, sortOrder: 0 },
      { id: 'unread', visible: true, sortOrder: 1 },
      { id: 'all', visible: false, sortOrder: 2 },
    ]);

    expect(merged.map((view) => view.id)).toEqual(
      DEFAULT_SMART_VIEW_DEFINITIONS.map((view) => view.id),
    );
    expect(merged.find((view) => view.id === 'read')).toEqual({
      id: 'read',
      visible: true,
      sortOrder: 4,
    });
    expect(merged.find((view) => view.id === 'all')).toEqual({
      id: 'all',
      visible: false,
      sortOrder: 3,
    });
  });

  it('adds Today visible right after Unread, keeping a custom order and hidden views', () => {
    const merged = normalizeSmartViews([
      { id: 'all', visible: true, sortOrder: 0 },
      { id: 'read', visible: false, sortOrder: 1 },
      { id: 'unread', visible: true, sortOrder: 2 },
      { id: 'saved', visible: false, sortOrder: 3 },
    ]);

    expect(merged).toEqual([
      { id: 'all', visible: true, sortOrder: 0 },
      { id: 'read', visible: false, sortOrder: 1 },
      { id: 'unread', visible: true, sortOrder: 2 },
      { id: 'today', visible: true, sortOrder: 3 },
      { id: 'saved', visible: false, sortOrder: 4 },
    ]);
  });

  it('keeps Today where the user put it once it is saved', () => {
    const saved = [
      { id: 'today' as const, visible: false, sortOrder: 0 },
      { id: 'saved' as const, visible: true, sortOrder: 1 },
      { id: 'unread' as const, visible: true, sortOrder: 2 },
      { id: 'all' as const, visible: true, sortOrder: 3 },
      { id: 'read' as const, visible: true, sortOrder: 4 },
    ];

    expect(normalizeSmartViews(saved)).toEqual(saved);
  });

  it('uses the default order with Today after Unread for fresh installs', () => {
    expect(normalizeSmartViews(undefined).map((view) => view.id)).toEqual(
      ['saved', 'unread', 'today', 'all', 'read'],
    );
  });

  it('shows Today in Manage Feeds Library for upgraded prefs', () => {
    const rows = buildLibraryItems([
      { id: 'saved', visible: true, sortOrder: 0 },
      { id: 'unread', visible: true, sortOrder: 1 },
      { id: 'all', visible: true, sortOrder: 2 },
      { id: 'read', visible: true, sortOrder: 3 },
    ]);

    expect(rows.map((row) => [row.id, row.label, row.visible])).toEqual([
      ['saved', 'Saved', true],
      ['unread', 'Unread', true],
      ['today', 'Today', true],
      ['all', 'All Items', true],
      ['read', 'Read', true],
    ]);
  });
});
