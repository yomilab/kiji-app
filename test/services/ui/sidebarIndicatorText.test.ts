import { describe, expect, it } from 'vitest';
import {
  sidebarIndicatorDone,
  sidebarIndicatorFailed,
  sidebarIndicatorOngoing,
} from '@/services/ui/sidebarIndicatorText';

describe('sidebarIndicatorText', () => {
  it('formats ongoing states with subject nouns', () => {
    expect(sidebarIndicatorOngoing('syncing')).toBe('Syncing feeds');
    expect(sidebarIndicatorOngoing('syncing', undefined, { subject: 'all' })).toBe('Syncing all');
    expect(sidebarIndicatorOngoing('refreshing', { count: 99 })).toBe('Refreshing 99 feeds');
    expect(sidebarIndicatorOngoing('importing', { count: 42 })).toBe('Importing 42 feeds');
    expect(sidebarIndicatorOngoing('fetching', { count: 12 }, { subject: 'favicons' })).toBe('Fetching 12 favicons');
    expect(sidebarIndicatorOngoing('clearing', { completed: 3, total: 10 }, { subject: 'articles' }))
      .toBe('Clearing 3/10 articles');
    expect(sidebarIndicatorOngoing('parsing')).toBe('Parsing OPML');
  });

  it('formats done and failed states with subject nouns', () => {
    expect(sidebarIndicatorDone('exporting')).toBe('Exported articles');
    expect(sidebarIndicatorDone('importing', 12)).toBe('Imported 12 feeds');
    expect(sidebarIndicatorDone('clearing', 5, { subject: 'saved' })).toBe('Cleared 5 saved');
    expect(sidebarIndicatorFailed('exporting')).toBe('Export articles failed');
    expect(sidebarIndicatorFailed('clearing', { subject: 'feeds' })).toBe('Clear feeds failed');
  });
});
