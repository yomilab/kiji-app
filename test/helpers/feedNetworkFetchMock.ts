import type { FeedNetworkFetchResult } from '@/services/feeds/feedsFetcher';

export const FEED_NETWORK_XML_STUB =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>stub</title></channel></rss>';

export function feedNetworkDataResult(data = FEED_NETWORK_XML_STUB): FeedNetworkFetchResult {
  return { notModified: false, data };
}

export function feedNetworkNotModifiedResult(): FeedNetworkFetchResult {
  return { notModified: true };
}
