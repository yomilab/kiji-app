import { describe, expect, it } from 'vitest';
import {
  sidebarIndicatorDone,
  sidebarIndicatorFailed,
  sidebarIndicatorOngoing,
} from '@/services/ui/sidebarIndicatorText';

describe('sidebarIndicatorText', () => {
  it('formats ongoing states with optional progress', () => {
    expect(sidebarIndicatorOngoing('syncing')).toBe('Syncing…');
    expect(sidebarIndicatorOngoing('importing', { count: 42 })).toBe('Importing 42…');
    expect(sidebarIndicatorOngoing('clearing', { completed: 3, total: 10 })).toBe('Clearing 3/10');
  });

  it('formats done and failed states', () => {
    expect(sidebarIndicatorDone('exporting')).toBe('Export done');
    expect(sidebarIndicatorDone('importing', 12)).toBe('Import done · 12');
    expect(sidebarIndicatorFailed('exporting')).toBe('Export failed');
  });
});
