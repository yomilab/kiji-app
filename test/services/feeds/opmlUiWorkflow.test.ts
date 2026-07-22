import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHttpGet = vi.fn();

vi.mock('@/services/http/httpClientFactory', () => ({
  httpClient: {
    get: (...args: unknown[]) => mockHttpGet(...args),
    fetchFeed: vi.fn(),
  },
}));

import {
  fetchOpmlTextFromUrl,
  isLikelyOpmlUrl,
  isOpmlDocument,
  navigateAfterOpmlImport,
} from '@/services/feeds/opmlUiWorkflow';

describe('opmlUiWorkflow url helpers', () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it('detects likely OPML URLs by pathname suffix', () => {
    expect(isLikelyOpmlUrl('https://raw.githubusercontent.com/yomilab/kiji-resource/main/feeds/tech.opml')).toBe(true);
    expect(isLikelyOpmlUrl('https://example.com/FEEDS/list.OPML')).toBe(true);
    expect(isLikelyOpmlUrl('https://example.com/feed.xml')).toBe(false);
    expect(isLikelyOpmlUrl('not-a-url')).toBe(false);
  });

  it('recognizes OPML document markup', () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Test</title></head><body>
  <outline type="rss" text="Example" xmlUrl="https://example.com/feed.xml" />
</body></opml>`;

    expect(isOpmlDocument(opml)).toBe(true);
    expect(isOpmlDocument('<rss><channel></channel></rss>')).toBe(false);
  });

  it('fetches and validates OPML text from a URL', async () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Test</title></head><body></body></opml>`;

    mockHttpGet.mockResolvedValue(opml);

    await expect(fetchOpmlTextFromUrl('https://example.com/list.opml')).resolves.toBe(opml);
    expect(mockHttpGet).toHaveBeenCalledWith('https://example.com/list.opml', expect.objectContaining({
      headers: expect.objectContaining({
        Accept: expect.stringContaining('xml'),
      }),
    }));
  });

  it('rejects non-OPML responses from OPML URLs', async () => {
    mockHttpGet.mockResolvedValue('<html><body>Nope</body></html>');

    await expect(fetchOpmlTextFromUrl('https://example.com/list.opml')).rejects.toThrow(
      'URL does not appear to be an OPML file.'
    );
  });

  it('reports XML parse errors for malformed OPML markup', async () => {
    const malformedOpml = `<?xml version="1.0"?>
<opml version="1.0"><body>
  <outline text="Broken" xmlUrl="https://example.com/feed"
</body></opml>`;

    mockHttpGet.mockResolvedValue(malformedOpml);

    await expect(fetchOpmlTextFromUrl('https://example.com/list.opml')).rejects.toThrow(
      /^XML parse error:/
    );
  });

  it('accepts OPML with unescaped ampersands in outline attributes', () => {
    const opml = `<?xml version='1.0' encoding='UTF-8' ?>
<opml version="1.0"><body>
  <outline text="Example" xmlUrl="https://example.com/feed.xml" description="A & B" />
</body></opml>`;

    expect(isOpmlDocument(opml)).toBe(true);
  });
});

describe('navigateAfterOpmlImport', () => {
  it('selects the first imported station when present', async () => {
    const selectTag = vi.fn().mockResolvedValue(undefined);
    const selectFeed = vi.fn().mockResolvedValue(undefined);

    await navigateAfterOpmlImport(
      {
        summary: { total: 1, imported: 1, skippedDuplicate: 0, invalid: 0, failed: 0 },
        importedFeeds: [{ id: 'feed-1', url: 'https://example.com/rss' }],
        navigationTarget: { type: 'station', stationName: 'Tech' },
      },
      { selectTag, selectFeed },
    );

    expect(selectTag).toHaveBeenCalledWith('Tech', { awaitInitialFetch: true });
    expect(selectFeed).not.toHaveBeenCalled();
  });

  it('selects the first imported feed when no station was created', async () => {
    const selectTag = vi.fn().mockResolvedValue(undefined);
    const selectFeed = vi.fn().mockResolvedValue(undefined);

    await navigateAfterOpmlImport(
      {
        summary: { total: 1, imported: 1, skippedDuplicate: 0, invalid: 0, failed: 0 },
        importedFeeds: [{ id: 'feed-1', url: 'https://example.com/rss' }],
        navigationTarget: {
          type: 'feed',
          feedId: 'feed-1',
          feedUrl: 'https://example.com/rss',
          feedTitle: 'Example',
        },
      },
      { selectTag, selectFeed },
    );

    expect(selectFeed).toHaveBeenCalledWith(
      'feed-1',
      'https://example.com/rss',
      'Example',
      { forceNetwork: true, awaitInitialFetch: true },
    );
    expect(selectTag).not.toHaveBeenCalled();
  });

  it('does nothing when import created no navigation target', async () => {
    const selectTag = vi.fn().mockResolvedValue(undefined);
    const selectFeed = vi.fn().mockResolvedValue(undefined);

    await navigateAfterOpmlImport(
      {
        summary: { total: 0, imported: 0, skippedDuplicate: 0, invalid: 0, failed: 0 },
        importedFeeds: [],
      },
      { selectTag, selectFeed },
    );

    expect(selectTag).not.toHaveBeenCalled();
    expect(selectFeed).not.toHaveBeenCalled();
  });
});
