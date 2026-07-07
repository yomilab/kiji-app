import { describe, expect, it } from 'vitest';
import {
  deriveOpmlDefaultStationName,
  isFlatOpmlRoot,
  resolveOutlineStationName,
} from '@/services/feeds/opmlStationResolution';

describe('opmlStationResolution', () => {
  it('derives a station name from OPML URL filenames', () => {
    expect(deriveOpmlDefaultStationName({
      url: 'https://raw.githubusercontent.com/spians/awesome-RSS-feeds/master/recommended/without_category/Football.opml',
    })).toBe('Football');
  });

  it('ignores generic OPML head titles', () => {
    expect(deriveOpmlDefaultStationName({
      opmlHeadTitle: 'Export from Plenary',
    })).toBeUndefined();
  });

  it('groups flat root feeds under the flat import station', () => {
    expect(isFlatOpmlRoot([true, true, true])).toBe(true);
    expect(resolveOutlineStationName({
      depth: 0,
      hasXmlUrl: true,
      label: 'EFL Championship',
      flatImportStation: 'Football',
    })).toBe('Football');
  });

  it('keeps hierarchical station folders separate from feed labels', () => {
    expect(resolveOutlineStationName({
      depth: 0,
      hasXmlUrl: false,
      label: 'Tech',
    })).toBe('Tech');
    expect(resolveOutlineStationName({
      depth: 1,
      hasXmlUrl: true,
      label: 'Example Feed',
      inheritedStation: 'Tech',
    })).toBe('Tech');
  });
});
