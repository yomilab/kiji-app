import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FaviconPixelMetrics } from '@/services/favicons/faviconQuality';

/** Documented ICO header fields from `extractIcoMetadata` (captured from fixture bytes). */
export interface DocumentedIcoMeta {
  width: number;
  height: number;
  colorCount: number;
  bitCount: number;
  byteLength: number;
  imageCount: number;
}

/** Documented raster dimensions from PNG IHDR (or measured decode) when pixels are mocked. */
export interface DocumentedRasterMeta {
  width: number;
  height: number;
}

/**
 * Documented pixel-analysis metrics (`analyzeFaviconPixels` at 32×32 sample).
 * Update `capturedWith` when re-measuring after a quality-rule change.
 */
export interface DocumentedPixelMeta extends FaviconPixelMetrics {
  capturedWith?: string;
}

export interface FaviconQualityCaseMeta {
  byteLength?: number;
  mimeHint?: string;
  ico?: DocumentedIcoMeta;
  raster?: DocumentedRasterMeta;
  pixels?: DocumentedPixelMeta;
  svgCharLength?: number;
}

export interface FaviconQualityCase {
  id: string;
  label: string;
  /** Bug/fix or changelog hook that introduced this fixture (for future accuracy audits). */
  fixRef: string;
  sourceUrl?: string;
  /** File under `test/fixtures/favicons/`. */
  fixtureFile?: string;
  /** Inline `data:` URL when no binary fixture is needed. */
  dataUrl?: string;
  expectedPlaceholder: boolean;
  meta: FaviconQualityCaseMeta;
  /**
   * jsdom often cannot decode PNG fixtures; mock `analyzeFaviconPixels` with `meta.pixels`
   * when exercising `isPlaceholderFaviconDataUrl` on raster fixtures.
   */
  useMetaPixelsForRasterCheck?: boolean;
}

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

const TRIVIAL_1X1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TINY_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg==';

const USABLE_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9IiMwMDc3Y2MiLz48cGF0aCBkPSJNOCAxMGgxNnYxMkg4em0wIDZoMTJ2Mkg4eiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

/**
 * Canonical catalog for favicon placeholder detection.
 * After each similar fix, append a case with documented `meta` from the real asset.
 */
export const FAVICON_QUALITY_CASES: FaviconQualityCase[] = [
  {
    id: 'techcrunch-origin-blank-ico',
    label: 'TechCrunch origin favicon.ico (blank 16×16 ICO)',
    fixRef: 'favicon quality — reject blank origin ICO (TechCrunch sidebar placeholder)',
    sourceUrl: 'https://techcrunch.com/favicon.ico',
    fixtureFile: 'techcrunch-origin-favicon.ico',
    expectedPlaceholder: true,
    meta: {
      byteLength: 198,
      mimeHint: 'image/x-icon',
      ico: {
        width: 16,
        height: 16,
        colorCount: 2,
        bitCount: 1,
        byteLength: 198,
        imageCount: 1,
      },
    },
  },
  {
    id: 'techcrunch-feed-gradient-w192',
    label: 'TechCrunch feed-declared WordPress PNG (w=192)',
    fixRef: 'favicon discovery — expand WordPress ?w= and prefer usable feed icon over blank ICO',
    sourceUrl:
      'https://techcrunch.com/wp-content/uploads/2015/02/cropped-cropped-favicon-gradient.png?w=192',
    fixtureFile: 'techcrunch-feed-icon-w192.png',
    expectedPlaceholder: false,
    useMetaPixelsForRasterCheck: true,
    meta: {
      byteLength: 8998,
      mimeHint: 'image/png',
      raster: { width: 192, height: 192 },
      pixels: {
        width: 192,
        height: 192,
        opaquePixelCount: 420,
        opaquePixelRatio: 0.41,
        nearWhiteOpaqueRatio: 0.12,
        uniqueOpaqueColors: 18,
        capturedWith:
          'proxy metrics (multi-color logo profile) — replace with browser canvas sample after re-capture',
      },
    },
  },
  {
    id: 'trivial-1x1-png',
    label: 'Trivial 1×1 PNG payload',
    fixRef: 'favicon quality — trivial raster byte-length gate',
    dataUrl: TRIVIAL_1X1_PNG,
    expectedPlaceholder: true,
    meta: {
      byteLength: 70,
      mimeHint: 'image/png',
      raster: { width: 1, height: 1 },
    },
  },
  {
    id: 'invalid-non-data-url',
    label: 'Non-data URL string',
    fixRef: 'favicon quality — reject non-image data URLs',
    dataUrl: 'https://example.com/favicon.ico',
    expectedPlaceholder: true,
    meta: {
      mimeHint: 'https',
    },
  },
  {
    id: 'tiny-svg-placeholder',
    label: 'Minimal SVG icon (short payload)',
    fixRef: 'favicon quality — short SVG length gate',
    dataUrl: TINY_SVG,
    expectedPlaceholder: true,
    meta: {
      mimeHint: 'image/svg+xml',
      svgCharLength: TINY_SVG.length,
    },
  },
  {
    id: 'usable-svg-logo',
    label: 'Structured SVG mark (longer payload)',
    fixRef: 'favicon quality — SVG length gate baseline',
    dataUrl: USABLE_SVG,
    expectedPlaceholder: false,
    meta: {
      mimeHint: 'image/svg+xml',
      svgCharLength: USABLE_SVG.length,
    },
  },
  {
    id: 'metrics-near-white-blank',
    label: 'Near-uniform white opaque raster (synthetic metrics)',
    fixRef: 'favicon quality — near-white opaque placeholder heuristic',
    expectedPlaceholder: true,
    meta: {
      pixels: {
        width: 32,
        height: 32,
        opaquePixelCount: 900,
        opaquePixelRatio: 0.88,
        nearWhiteOpaqueRatio: 0.99,
        uniqueOpaqueColors: 2,
        capturedWith: 'synthetic — blank white tile',
      },
    },
  },
  {
    id: 'metrics-multicolor-logo',
    label: 'Multi-color logo raster (synthetic metrics)',
    fixRef: 'favicon quality — conservative pass for real brand marks',
    expectedPlaceholder: false,
    meta: {
      pixels: {
        width: 32,
        height: 32,
        opaquePixelCount: 420,
        opaquePixelRatio: 0.41,
        nearWhiteOpaqueRatio: 0.12,
        uniqueOpaqueColors: 18,
        capturedWith: 'synthetic — colorful logo profile',
      },
    },
  },
  {
    id: 'metrics-too-few-opaque-pixels',
    label: 'Sparse opaque pixels on 32×32 sample',
    fixRef: 'favicon quality — minimum opaque pixel count on larger samples',
    expectedPlaceholder: true,
    meta: {
      pixels: {
        width: 32,
        height: 32,
        opaquePixelCount: 4,
        opaquePixelRatio: 0.0039,
        nearWhiteOpaqueRatio: 0,
        uniqueOpaqueColors: 4,
        capturedWith: 'synthetic — nearly empty tile',
      },
    },
  },
  {
    id: 'metrics-low-opaque-ratio',
    label: 'Very low opaque pixel ratio',
    fixRef: 'favicon quality — minimum opaque ratio gate',
    expectedPlaceholder: true,
    meta: {
      pixels: {
        width: 32,
        height: 32,
        opaquePixelCount: 3,
        opaquePixelRatio: 0.03,
        nearWhiteOpaqueRatio: 0,
        uniqueOpaqueColors: 3,
        capturedWith: 'synthetic — faint marks',
      },
    },
  },
  {
    id: 'metrics-too-small-dimensions',
    label: 'Decoded dimensions below 3×3',
    fixRef: 'favicon quality — minimum decoded dimensions',
    expectedPlaceholder: true,
    meta: {
      pixels: {
        width: 2,
        height: 2,
        opaquePixelCount: 4,
        opaquePixelRatio: 1,
        nearWhiteOpaqueRatio: 0,
        uniqueOpaqueColors: 4,
        capturedWith: 'synthetic — 2×2 icon',
      },
    },
  },
];

export function readFaviconFixtureBytes(fixtureFile: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, fixtureFile));
}

export function fixtureMimeHint(caseMeta: FaviconQualityCaseMeta): string {
  if (caseMeta.mimeHint) {
    return caseMeta.mimeHint;
  }
  if (caseMeta.ico) {
    return 'image/x-icon';
  }
  return 'image/png';
}

export function buildDataUrlFromFixture(caseEntry: FaviconQualityCase): string {
  if (caseEntry.dataUrl) {
    return caseEntry.dataUrl;
  }
  if (!caseEntry.fixtureFile) {
    throw new Error(`Case ${caseEntry.id} has no dataUrl or fixtureFile`);
  }
  const bytes = readFaviconFixtureBytes(caseEntry.fixtureFile);
  const mime = fixtureMimeHint(caseEntry.meta);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function casesWithDataUrl(): FaviconQualityCase[] {
  return FAVICON_QUALITY_CASES.filter((caseEntry) => caseEntry.dataUrl || caseEntry.fixtureFile);
}

export function casesWithPixelMeta(): FaviconQualityCase[] {
  return FAVICON_QUALITY_CASES.filter((caseEntry) => caseEntry.meta.pixels);
}

export function casesWithIcoMeta(): FaviconQualityCase[] {
  return FAVICON_QUALITY_CASES.filter((caseEntry) => caseEntry.meta.ico);
}
