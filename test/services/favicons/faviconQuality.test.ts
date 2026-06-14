import { describe, expect, it } from 'vitest';
import {
  buildDataUrlFromFixture,
  casesWithIcoMeta,
} from '../../fixtures/favicons/quality-cases';
import {
  isPlaceholderFromPixelMetrics,
} from '@/services/favicons/faviconQuality';

describe('faviconQuality', () => {
  it('exports pixel metrics helper aligned with fixture catalog', () => {
    const techcrunchCase = casesWithIcoMeta().find((c) => c.id === 'techcrunch-origin-blank-ico');
    expect(techcrunchCase).toBeDefined();
    const dataUrl = buildDataUrlFromFixture(techcrunchCase!);
    expect(dataUrl.startsWith('data:image/x-icon')).toBe(true);
  });

  it('isPlaceholderFromPixelMetrics rejects documented near-white blank profile', () => {
    expect(
      isPlaceholderFromPixelMetrics({
        width: 32,
        height: 32,
        opaquePixelCount: 900,
        opaquePixelRatio: 0.88,
        nearWhiteOpaqueRatio: 0.99,
        uniqueOpaqueColors: 2,
      }),
    ).toBe(true);
  });
});
