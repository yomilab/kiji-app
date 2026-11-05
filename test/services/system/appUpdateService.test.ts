import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  compareReleaseVersions,
  normalizeReleaseNoteSections,
  pickRecommendedDownload,
} from '@/services/system/appUpdateService';
import type { ReleaseDownloadOption } from '@/services/system/appUpdateTypes';

describe('appUpdateService', () => {
  describe('compareReleaseVersions', () => {
    it('orders semver releases correctly', () => {
      expect(compareReleaseVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(compareReleaseVersions('1.0.1', '1.0.0')).toBe(1);
      expect(compareReleaseVersions('v1.0.0', '1.0.0')).toBe(0);
      expect(compareReleaseVersions('2.0.0', '10.0.0')).toBe(-1);
    });
  });

  describe('pickRecommendedDownload', () => {
    const options: ReleaseDownloadOption[] = [
      {
        id: 'mac-arm64',
        platform: 'mac',
        label: 'macOS Apple Silicon',
        fileName: 'Yomi Reader-1.0.2-macos-aarch64.dmg',
        version: '1.0.2',
        url: 'https://example.com/mac-arm64.dmg',
      },
      {
        id: 'windows-x64',
        platform: 'windows',
        label: 'Windows x64',
        fileName: 'Yomi Reader-1.0.2-windows-x86_64.msi',
        version: '1.0.2',
        url: 'https://example.com/windows-x64.msi',
      },
    ];

    beforeEach(() => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('prefers mac arm64 assets on macOS', () => {
      expect(pickRecommendedDownload(options)?.id).toBe('mac-arm64');
    });
  });

  describe('normalizeReleaseNoteSections', () => {
    it('keeps well-formed groups in order', () => {
      expect(normalizeReleaseNoteSections({
        sections: [
          { title: 'New', items: ['Reader themes.'] },
          { title: 'Fixed', items: ['Crash on launch.', 'Wrong unread count.'] },
        ],
      })).toEqual([
        { title: 'New', items: ['Reader themes.'] },
        { title: 'Fixed', items: ['Crash on launch.', 'Wrong unread count.'] },
      ]);
    });

    it('returns no groups for legacy or malformed manifests', () => {
      expect(normalizeReleaseNoteSections(undefined)).toEqual([]);
      expect(normalizeReleaseNoteSections({ sections: 'Fixed stuff' })).toEqual([]);
      expect(normalizeReleaseNoteSections({
        sections: [
          { title: 'Fixed', items: [42, '', '  '] },
          { title: '', items: ['No title'] },
          null,
        ],
      })).toEqual([]);
    });

    it('bounds remote input', () => {
      const sections = normalizeReleaseNoteSections({
        sections: Array.from({ length: 20 }, (_, index) => ({
          title: `Group ${index}`,
          items: Array.from({ length: 50 }, () => 'x'.repeat(2_000)),
        })),
      });
      expect(sections).toHaveLength(8);
      expect(sections[0].items).toHaveLength(30);
      expect(sections[0].items[0].length).toBeLessThanOrEqual(600);
    });
  });
});
