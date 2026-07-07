import { logger } from '@/services/logger';

const LARGE_PAYLOAD_BYTES = 512 * 1024;
const LARGE_DOM_NODE_COUNT = 1000;
const LARGE_MEDIA_COUNT = 25;
const SLOW_PARSE_MS = 500;

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export interface FeedParseAttribution {
  feedUrl: string;
  parserPath: string;
  rawBytes: number;
  rawChars: number;
  itemCount: number;
  durationMs: number;
  workerQueueDepth?: number;
  workerPendingCount?: number;
  domParserUsed: boolean;
  domNodeCount?: number;
  imageElementCount?: number;
  mediaElementCount?: number;
  enclosureCount?: number;
  maxItemContentChars?: number;
  totalItemContentChars?: number;
  dateEnrichmentDomParserUsed?: boolean;
  dateEnrichmentElementCount?: number;
}

export interface ArticleRenderAttribution {
  articleHash?: string;
  feedId?: string;
  feedTitle?: string;
  articleUrl?: string;
  mode: 'basic' | 'reader';
  standalone: boolean;
  htmlBytes: number;
  htmlChars: number;
  shadowElementCount: number;
  imageElementCount: number;
  mediaElementCount: number;
  linkElementCount: number;
  textChars: number;
}

export function estimateUtf8Bytes(value: string): number {
  if (!value) {
    return 0;
  }
  return textEncoder?.encode(value).byteLength ?? value.length * 2;
}

export function shouldLogDetailedAttribution(input: {
  rawBytes?: number;
  htmlBytes?: number;
  domNodeCount?: number;
  mediaElementCount?: number;
  durationMs?: number;
  parserPath?: string;
}): boolean {
  return (input.rawBytes ?? input.htmlBytes ?? 0) >= LARGE_PAYLOAD_BYTES
    || (input.domNodeCount ?? 0) >= LARGE_DOM_NODE_COUNT
    || (input.mediaElementCount ?? 0) >= LARGE_MEDIA_COUNT
    || (input.durationMs ?? 0) >= SLOW_PARSE_MS
    || (!!input.parserPath && input.parserPath !== 'feedsmith');
}

export function logFeedNetworkAttribution(context: {
  feedUrl: string;
  requestId?: string;
  notModified: boolean;
  responseBytes: number;
  responseChars: number;
  durationMs: number;
}): void {
  logger.info('WebKitAttribution', 'Feed network response attributed', {
    event: 'feed-network-response',
    ...context,
    largePayload: context.responseBytes >= LARGE_PAYLOAD_BYTES,
  });
}

export function logFeedParseAttribution(context: FeedParseAttribution): void {
  logger.info('WebKitAttribution', 'Feed parse attributed', {
    event: 'feed-parse-attribution',
    ...context,
    requiresHeapCorrelation: shouldLogDetailedAttribution({
      rawBytes: context.rawBytes,
      domNodeCount: context.domNodeCount,
      mediaElementCount: context.mediaElementCount,
      durationMs: context.durationMs,
      parserPath: context.parserPath,
    }),
  });
}

export function logReaderDomAttribution(context: {
  url: string;
  htmlBytes: number;
  htmlChars: number;
  domNodeCount: number;
  imageElementCount: number;
  mediaElementCount: number;
  durationMs: number;
  readabilityLength?: number;
  outputHtmlBytes?: number;
}): void {
  logger.info('WebKitAttribution', 'Reader DOM parse attributed', {
    event: 'reader-dom-attribution',
    ...context,
    requiresHeapCorrelation: shouldLogDetailedAttribution({
      htmlBytes: context.htmlBytes,
      domNodeCount: context.domNodeCount,
      mediaElementCount: context.mediaElementCount,
      durationMs: context.durationMs,
    }),
  });
}

export function logArticleRenderAttribution(context: ArticleRenderAttribution): void {
  logger.info('WebKitAttribution', 'Article render DOM attributed', {
    event: 'article-render-attribution',
    ...context,
    requiresHeapCorrelation: shouldLogDetailedAttribution({
      htmlBytes: context.htmlBytes,
      domNodeCount: context.shadowElementCount,
      mediaElementCount: context.mediaElementCount,
    }),
  });
}

export function logNativeFeedRefreshAttribution(context: {
  feedId: string;
  status: string;
  insertedCount?: number;
  error?: string;
  source: 'background' | 'foreground';
}): void {
  logger.info('WebKitAttribution', 'Native feed refresh attributed', {
    event: 'native-feed-refresh-attribution',
    parserPath: 'native',
    domParserUsed: false,
    ...context,
  });
}

export function logNativeFeedRefreshCycleAttribution(context: {
  source: 'background' | 'foreground';
  feedCount: number;
  changedFeeds: number;
  notModifiedFeeds: number;
  failedFeeds: number;
  insertedArticles: number;
  perFeedAttributionSuppressed: boolean;
}): void {
  logger.info('WebKitAttribution', 'Native feed refresh cycle attributed', {
    event: 'native-feed-refresh-cycle-attribution',
    parserPath: 'native',
    domParserUsed: false,
    ...context,
  });
}

export interface RendererSessionMemoryAttribution {
  loadedArticleCount: number;
  articlesTotalCount: number;
  estimatedSerializedListKb: number;
  internFeedCount: number;
  articleViewOpen: boolean;
  articleListScrollActive: boolean;
  searchActive: boolean;
}

export function logRendererSessionMemoryAttribution(
  context: RendererSessionMemoryAttribution,
): void {
  logger.info('WebKitAttribution', 'Renderer session memory attributed', {
    event: 'renderer-session-memory-attribution',
    ...context,
  });
}

export function logListRefreshAttribution(context: {
  sourceKey: string;
  rowCount: number;
  totalCount: number;
  newHashCount: number;
  estimatedSerializedListKb: number;
  trigger: 'background-refresh' | 'station-refresh' | 'scheduler-flush';
}): void {
  logger.info('WebKitAttribution', 'List refresh attributed', {
    event: 'list-refresh-attribution',
    ...context,
  });
}

export function logArticleOpenAttribution(context: {
  articleHash: string;
  feedId: string;
  mode: 'basic' | 'reader';
  standalone: boolean;
}): void {
  logger.info('WebKitAttribution', 'Article open attributed', {
    event: 'article-open-attribution',
    ...context,
  });
}
