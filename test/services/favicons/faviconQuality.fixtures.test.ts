import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as faviconQuality from '@/services/favicons/faviconQuality';
import {
  buildDataUrlFromFixture,
  casesWithDataUrl,
  casesWithIcoMeta,
  casesWithPixelMeta,
  FAVICON_QUALITY_CASES,
  readFaviconFixtureBytes,
} from '../../fixtures/favicons/quality-cases';

const {
  extractIcoMetadata,
  isLowQualityIcoDataUrl,
  isPlaceholderFromPixelMetrics,
  isPlaceholderFaviconDataUrl,
  isTrivialRasterDataUrl,
} = faviconQuality;

function casesForFullPlaceholderCheck() {
  return casesWithDataUrl().filter((caseEntry) => !caseEntry.useMetaPixelsForRasterCheck);
}

describe('faviconQuality fixture catalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has unique case ids', () => {
    const ids = FAVICON_QUALITY_CASES.map((caseEntry) => caseEntry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('documented binary meta', () => {
    for (const caseEntry of FAVICON_QUALITY_CASES) {
      if (!caseEntry.fixtureFile || caseEntry.meta.byteLength === undefined) {
        continue;
      }

      it(`${caseEntry.id}: byteLength matches fixture file`, () => {
        const bytes = readFaviconFixtureBytes(caseEntry.fixtureFile!);
        expect(bytes.length).toBe(caseEntry.meta.byteLength);
      });
    }

    for (const caseEntry of casesWithIcoMeta()) {
      it(`${caseEntry.id}: ICO meta matches extractIcoMetadata`, () => {
        const dataUrl = buildDataUrlFromFixture(caseEntry);
        const documented = caseEntry.meta.ico!;
        const extracted = extractIcoMetadata(dataUrl);

        expect(extracted).toEqual(
          expect.objectContaining({
            width: documented.width,
            height: documented.height,
            colorCount: documented.colorCount,
            bitCount: documented.bitCount,
            byteLength: documented.byteLength,
            imageCount: documented.imageCount,
          }),
        );
        expect(isLowQualityIcoDataUrl(dataUrl)).toBe(caseEntry.expectedPlaceholder);
      });
    }
  });

  describe('documented pixel meta', () => {
    for (const caseEntry of casesWithPixelMeta()) {
      it(`${caseEntry.id}: pixel rules match expectedPlaceholder`, () => {
        const pixels = caseEntry.meta.pixels!;
        expect(isPlaceholderFromPixelMetrics(pixels)).toBe(caseEntry.expectedPlaceholder);
      });
    }
  });

  describe('isPlaceholderFaviconDataUrl accuracy', () => {
    for (const caseEntry of casesForFullPlaceholderCheck()) {
      it(`${caseEntry.id}: ${caseEntry.label}`, async () => {
        const dataUrl = buildDataUrlFromFixture(caseEntry);

        if (caseEntry.meta.svgCharLength !== undefined) {
          expect(dataUrl.length).toBe(caseEntry.meta.svgCharLength);
        }

        if (caseEntry.id === 'trivial-1x1-png') {
          expect(isTrivialRasterDataUrl(dataUrl)).toBe(true);
        }

        await expect(isPlaceholderFaviconDataUrl(dataUrl)).resolves.toBe(caseEntry.expectedPlaceholder);
      });
    }
  });

  describe('raster fixtures with documented pixels (jsdom-safe)', () => {
    for (const caseEntry of casesWithDataUrl().filter((c) => c.useMetaPixelsForRasterCheck)) {
      it(`${caseEntry.id}: documented file meta + pixel profile`, () => {
        expect(caseEntry.meta.pixels).toBeDefined();
        expect(caseEntry.meta.raster).toBeDefined();

        const dataUrl = buildDataUrlFromFixture(caseEntry);
        expect(isTrivialRasterDataUrl(dataUrl)).toBe(false);
        expect(isPlaceholderFromPixelMetrics(caseEntry.meta.pixels!)).toBe(caseEntry.expectedPlaceholder);
      });
    }
  });
});
