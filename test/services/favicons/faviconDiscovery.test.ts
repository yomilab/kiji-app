import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as faviconQuality from '@/services/favicons/faviconQuality';
import { discoverFaviconDataUrl, __faviconDiscoveryTestUtils } from '@/services/favicons/faviconDiscovery';
import { buildDataUrlFromFixture, casesWithIcoMeta } from '../../fixtures/favicons/quality-cases';

const TECHCRUNCH_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TechCrunch</title>
    <link>https://techcrunch.com/</link>
    <image>
      <url>https://techcrunch.com/wp-content/uploads/2015/02/cropped-cropped-favicon-gradient.png?w=32</url>
    </image>
  </channel>
</rss>`;

const TECHCRUNCH_HTML = `
<link rel="icon" href="https://techcrunch.com/wp-content/uploads/2015/02/cropped-cropped-favicon-gradient.png?w=32" sizes="32x32" />
<link rel="icon" href="https://techcrunch.com/wp-content/uploads/2015/02/cropped-cropped-favicon-gradient.png?w=192" sizes="192x192" />
`;

describe('faviconDiscovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('expands feed-declared WordPress icons to larger width candidates first', () => {
    const urls = __faviconDiscoveryTestUtils.extractFeedXmlIconUrls(
      TECHCRUNCH_FEED_XML,
      'https://techcrunch.com/feed/',
    );

    expect(urls.some((url) => url.includes('w=192'))).toBe(true);
    const sorted = __faviconDiscoveryTestUtils.sortIconCandidatesByPreferredSize(urls);
    expect(sorted[0]).toContain('w=192');
  });

  it('skips blank origin favicon.ico and prefers a later usable candidate', async () => {
    const techcrunchIcoCase = casesWithIcoMeta().find((c) => c.id === 'techcrunch-origin-blank-ico');
    const blankIcoDataUrl = buildDataUrlFromFixture(techcrunchIcoCase!);
    const goodPngDataUrl = 'data:image/png;base64,GOODPNG';

    vi.spyOn(faviconQuality, 'isUsableFaviconDataUrl').mockImplementation(async (dataUrl) => {
      return dataUrl === goodPngDataUrl;
    });

    const fetchImageDataUrl = vi.fn(async (url: string) => {
      if (url.endsWith('/favicon.ico')) {
        return blankIcoDataUrl;
      }
      if (url.includes('w=192')) {
        return goodPngDataUrl;
      }
      return null;
    });

    const favicon = await discoverFaviconDataUrl(
      'https://techcrunch.com/feed/',
      {
        fetchImageDataUrl,
        fetchText: vi.fn(async () => TECHCRUNCH_HTML),
      },
      { feedXmlText: TECHCRUNCH_FEED_XML },
    );

    expect(favicon).toBe(goodPngDataUrl);
    expect(fetchImageDataUrl).toHaveBeenCalledWith(
      expect.stringContaining('w=192'),
      undefined,
    );
  });

  it('does not return a rejected placeholder when no usable icon exists', async () => {
    const techcrunchIcoCase = casesWithIcoMeta().find((c) => c.id === 'techcrunch-origin-blank-ico');
    const blankIcoDataUrl = buildDataUrlFromFixture(techcrunchIcoCase!);

    vi.spyOn(faviconQuality, 'isUsableFaviconDataUrl').mockResolvedValue(false);

    const favicon = await discoverFaviconDataUrl(
      'https://example.com/feed/',
      {
        fetchImageDataUrl: vi.fn(async () => blankIcoDataUrl),
        fetchText: vi.fn(async () => '<html></html>'),
      },
    );

    expect(favicon).toBeNull();
  });
});
