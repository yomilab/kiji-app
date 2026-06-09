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
});
