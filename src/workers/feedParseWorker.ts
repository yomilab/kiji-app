import { parseFeed } from '@/services/feeds/feedsFetcher';
import type { FeedItem } from '@/services/feeds/feedsFetcher';

interface ParseRequest {
  id: number;
  rawText: string;
  feedUrl: string;
}

interface ParseSuccess {
  id: number;
  ok: true;
  items: FeedItem[];
}

interface ParseFailure {
  id: number;
  ok: false;
  error: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, rawText, feedUrl } = event.data;

  try {
    const items = parseFeed(rawText, feedUrl);
    const response: ParseSuccess = { id, ok: true, items };
    self.postMessage(response);
  } catch (error) {
    const response: ParseFailure = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
