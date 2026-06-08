import type { FeedNetworkFetchResult } from '@/services/feeds/feedsFetcher';

export const FEED_NETWORK_XML_STUB = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>stub</title>
    <item>
      <title>Stub item</title>
      <link>https://example.com/item-1</link>
      <guid>item-1</guid>
    </item>
  </channel>
</rss>`;

export function feedNetworkDataResult(data = FEED_NETWORK_XML_STUB): FeedNetworkFetchResult {
  return { notModified: false, data };
}

export function feedNetworkNotModifiedResult(): FeedNetworkFetchResult {
  return { notModified: true };
}
