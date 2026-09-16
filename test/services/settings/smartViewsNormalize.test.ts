import { describe, expect, it } from 'vitest';
import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';
import { normalizeSmartViews } from '@/services/settings/settingsManager';

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
      sortOrder: 3,
    });
    expect(merged.find((view) => view.id === 'all')).toEqual({
      id: 'all',
      visible: false,
      sortOrder: 2,
    });
  });
});
