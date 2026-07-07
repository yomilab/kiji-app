import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ArticleRecord } from '@/lib/tauriClient/contracts';
import type { Article } from '@/types/article';
import { recordToArticle } from '@/stores/articleStore';

/** Mirrors production Tech-station scale from the local KiJi library. */
export const TECH_STATION_SCENARIO = {
  feedCount: 148,
  articleCount: 6341,
  pageSize: 100,
} as const;

/** Whole-library scale for overnight-style session simulation. */
export const LIBRARY_SCENARIO = {
  feedCount: 377,
  articleCount: 14361,
  pageSize: 100,
} as const;

export type ArticleRecordBuildOptions = {
  feedCount: number;
  articleCount: number;
  faviconSizeKb?: number;
  /** When true, each row gets a unique favicon payload (simulates IPC copies). */
  uniqueFaviconPerRow?: boolean;
};

export interface ProcessMemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
}

export interface LoadMemoryReport extends ProcessMemorySnapshot {
  heapDeltaMb: number;
  rssDeltaMb: number;
  peakHeapUsedMb: number;
  serializedRetainedKb: number;
  estimatedStringBytes: number;
  articleCount: number;
  elapsedMs: number;
  distinctFaviconRefs: number;
  internedFeedCount: number;
}

const DEFAULT_KIJI_DB = join(homedir(), 'Library/Application Support/com.yomilab.kiji/kiji.db');

const faviconTemplateCache = new Map<string, string[]>();

const getFaviconTemplates = (feedCount: number, faviconSizeKb: number): string[] => {
  const key = `${feedCount}:${faviconSizeKb}`;
  const cached = faviconTemplateCache.get(key);
  if (cached) {
    return cached;
  }

  const payloadChars = Math.max(16, Math.floor((faviconSizeKb * 1024) / 2));
  const templates = Array.from({ length: feedCount }, (_, index) =>
    `data:image/png;base64,feed-${index}-${'x'.repeat(payloadChars)}`,
  );
  faviconTemplateCache.set(key, templates);
  return templates;
};

export function buildRealisticArticleRecord(
  index: number,
  options: ArticleRecordBuildOptions,
): ArticleRecord {
  const { feedCount, faviconSizeKb = 4, uniqueFaviconPerRow = false } = options;
  const feedIndex = index % feedCount;
  const feedId = `feed-${feedIndex}`;
  const favicons = getFaviconTemplates(feedCount, faviconSizeKb);
  const faviconBase = favicons[feedIndex];

  return {
    hash: `hash-${index}`,
    feedId,
    title: `Article ${index}`,
    description: `Description for article ${index}`,
    content: '',
    link: `https://example.com/article-${index}`,
    author: 'Author',
    publishedDate: new Date(Date.UTC(2026, 0, 1, 0, index % 60)).toISOString(),
    fetchedDate: new Date(Date.UTC(2026, 0, 2)).toISOString(),
    read: index % 3 === 0,
    starred: false,
    saved: false,
    savedArticleId: null,
    lastReadAt: null,
    metadata: {
      previewImage: index % 5 === 0 ? `https://cdn.example.com/preview-${index}.jpg` : undefined,
      images: [`https://cdn.example.com/image-a-${index}.jpg`, `https://cdn.example.com/image-b-${index}.jpg`],
      categories: ['news', 'tech'],
      authors: [{ name: `Author ${feedIndex}` }],
      enclosures: index % 20 === 0
        ? [{ url: `https://cdn.example.com/audio-${index}.mp3`, type: 'audio/mpeg', duration: 3600 }]
        : undefined,
    },
    feedUrl: `https://feed-${feedIndex}.example.com/rss.xml`,
    feedTitle: `Feed ${feedIndex}`,
    feedFavicon: uniqueFaviconPerRow ? `${faviconBase}::row-${index}` : `${faviconBase}`,
    feedFaviconHasTransparency: true,
    feedFaviconBgLight: '#ffffff',
    feedFaviconBgDark: '#111111',
    feedImage: null,
  };
}

export function buildRealisticArticleRecords(options: ArticleRecordBuildOptions): ArticleRecord[] {
  const records: ArticleRecord[] = new Array(options.articleCount);
  for (let index = 0; index < options.articleCount; index += 1) {
    records[index] = buildRealisticArticleRecord(index, options);
  }
  return records;
}

export function buildRealisticArticleRecordPage(
  offset: number,
  limit: number,
  options: ArticleRecordBuildOptions,
): ArticleRecord[] {
  const end = Math.min(offset + limit, options.articleCount);
  const page: ArticleRecord[] = new Array(Math.max(0, end - offset));
  for (let index = offset; index < end; index += 1) {
    page[index - offset] = buildRealisticArticleRecord(index, options);
  }
  return page;
}

export function materializeNaiveListArticles(records: ArticleRecord[]): Article[] {
  return records.map((record) => recordToArticle(record, { forList: false }));
}

export function materializePreparedListArticles(records: ArticleRecord[]): Article[] {
  return records.map((record) => recordToArticle(record, { forList: true }));
}

import { mergeUniqueArticlesByHash } from '@/services/articles/mergeUniqueArticlesByHash';

export { mergeUniqueArticlesByHash };

export function snapshotProcessMemory(): ProcessMemorySnapshot {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: roundMb(memory.heapUsed),
    heapTotalMb: roundMb(memory.heapTotal),
    rssMb: roundMb(memory.rss),
    externalMb: roundMb(memory.external),
  };
}

export function forceGarbageCollection(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    globalThis.gc();
  }
}

export function measureLoadMemory<T>(
  run: () => T,
  getMetrics: (
    result: T,
  ) => Pick<
    LoadMemoryReport,
    'articleCount' | 'distinctFaviconRefs' | 'internedFeedCount' | 'peakHeapUsedMb' | 'serializedRetainedKb' | 'estimatedStringBytes'
  >,
): { result: T; memory: LoadMemoryReport } {
  forceGarbageCollection();
  const before = snapshotProcessMemory();
  const startedAt = performance.now();
  const result = run();
  const elapsedMs = performance.now() - startedAt;
  forceGarbageCollection();
  const after = snapshotProcessMemory();

  return {
    result,
    memory: buildLoadMemoryReport(before, after, elapsedMs, getMetrics(result)),
  };
}

export async function measureLoadMemoryAsync<T>(
  run: () => Promise<T>,
  getMetrics: (
    result: T,
  ) => Pick<
    LoadMemoryReport,
    'articleCount' | 'distinctFaviconRefs' | 'internedFeedCount' | 'peakHeapUsedMb' | 'serializedRetainedKb' | 'estimatedStringBytes'
  >,
): Promise<{ result: T; memory: LoadMemoryReport }> {
  forceGarbageCollection();
  const before = snapshotProcessMemory();
  const startedAt = performance.now();
  const result = await run();
  const elapsedMs = performance.now() - startedAt;
  forceGarbageCollection();
  const after = snapshotProcessMemory();

  return {
    result,
    memory: buildLoadMemoryReport(before, after, elapsedMs, getMetrics(result)),
  };
}

function buildLoadMemoryReport(
  before: ProcessMemorySnapshot,
  after: ProcessMemorySnapshot,
  elapsedMs: number,
  metrics: Pick<
    LoadMemoryReport,
    'articleCount' | 'distinctFaviconRefs' | 'internedFeedCount' | 'peakHeapUsedMb' | 'serializedRetainedKb' | 'estimatedStringBytes'
  >,
): LoadMemoryReport {
  return {
    ...after,
    heapDeltaMb: roundMb(Math.max(0, after.heapUsedMb - before.heapUsedMb)),
    rssDeltaMb: roundMb(Math.max(0, after.rssMb - before.rssMb)),
    elapsedMs: roundPerformanceMs(elapsedMs),
    peakHeapUsedMb: metrics.peakHeapUsedMb,
    ...metrics,
  };
}

export function estimateSerializedArticleListBytes(articles: Article[]): number {
  return Buffer.byteLength(JSON.stringify(articles));
}

export function measureGeneratedScrollLoadMemory(
  articleCount: number,
  pageSize: number,
  mode: 'naive' | 'prepared',
  getPageRecords: (offset: number, limit: number) => ArticleRecord[],
  getInternedFeedCount: () => number,
): { result: Article[]; memory: LoadMemoryReport } {
  forceGarbageCollection();
  const before = snapshotProcessMemory();
  const startedAt = performance.now();
  const { result, peakHeapUsedMb } = simulateGeneratedInfiniteScrollLoad(
    articleCount,
    pageSize,
    mode,
    getPageRecords,
  );
  const elapsedMs = performance.now() - startedAt;
  const after = snapshotProcessMemory();
  const serializedRetainedKb = roundKb(estimateSerializedArticleListBytes(result));
  const estimatedStringBytes = mode === 'prepared'
    ? estimateInternedRetainedStringBytes(result)
    : estimateRetainedStringBytes(result);

  return {
    result,
    memory: buildLoadMemoryReport(before, after, elapsedMs, {
      peakHeapUsedMb,
      serializedRetainedKb,
      estimatedStringBytes,
      articleCount: result.length,
      distinctFaviconRefs: countDistinctFaviconReferences(result),
      internedFeedCount: getInternedFeedCount(),
    }),
  };
}

export function simulateInfiniteScrollLoad(
  records: ArticleRecord[],
  pageSize: number,
  mode: 'naive' | 'prepared',
): Article[] {
  return simulateGeneratedInfiniteScrollLoad(
    records.length,
    pageSize,
    mode,
    (offset, limit) => records.slice(offset, offset + limit),
  ).result;
}

export function simulateGeneratedInfiniteScrollLoad(
  articleCount: number,
  pageSize: number,
  mode: 'naive' | 'prepared',
  getPageRecords: (offset: number, limit: number) => ArticleRecord[],
): { result: Article[]; peakHeapUsedMb: number } {
  let loaded: Article[] = [];
  let peakHeapBytes = process.memoryUsage().heapUsed;

  for (let offset = 0; offset < articleCount; offset += pageSize) {
    const pageRecords = getPageRecords(offset, pageSize);
    const pageArticles = mode === 'naive'
      ? materializeNaiveListArticles(pageRecords)
      : materializePreparedListArticles(pageRecords);
    loaded = mergeUniqueArticlesByHash(loaded, pageArticles);
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  }

  return { result: loaded, peakHeapUsedMb: roundMb(peakHeapBytes) };
}

export function countArticlesWithFavicon(articles: Article[]): number {
  return articles.filter((article) => article.feedFavicon).length;
}

export function countDistinctFaviconReferences(articles: Article[]): number {
  const refs = new Set<string>();
  for (const article of articles) {
    if (article.feedFavicon) {
      refs.add(article.feedFavicon);
    }
  }
  return refs.size;
}

export function estimateInternedRetainedStringBytes(articles: Article[]): number {
  let bytes = 0;
  const faviconBytesByFeedId = new Map<string, number>();

  for (const article of articles) {
    if (article.feedFavicon && !faviconBytesByFeedId.has(article.feedId)) {
      faviconBytesByFeedId.set(article.feedId, article.feedFavicon.length * 2);
    }
    bytes += (article.feedTitle?.length ?? 0) * 2;
    bytes += (article.feedUrl?.length ?? 0) * 2;
    bytes += (article.title?.length ?? 0) * 2;
    bytes += (article.description?.length ?? 0) * 2;
    if (article.images) {
      bytes += article.images.join('').length * 2;
    }
    if (article.categories) {
      bytes += article.categories.join('').length * 2;
    }
  }

  for (const faviconBytes of faviconBytesByFeedId.values()) {
    bytes += faviconBytes;
  }

  return bytes;
}

export function estimateRetainedStringBytes(articles: Article[]): number {
  let bytes = 0;

  for (const article of articles) {
    bytes += (article.feedFavicon?.length ?? 0) * 2;
    bytes += (article.feedTitle?.length ?? 0) * 2;
    bytes += (article.feedUrl?.length ?? 0) * 2;
    bytes += (article.title?.length ?? 0) * 2;
    bytes += (article.description?.length ?? 0) * 2;
    if (article.images) {
      bytes += article.images.join('').length * 2;
    }
    if (article.categories) {
      bytes += article.categories.join('').length * 2;
    }
  }

  return bytes;
}

export function resolveOptionalKiJiDbPath(): string | null {
  const configured = process.env.KIJI_TEST_DB?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (existsSync(DEFAULT_KIJI_DB)) {
    return DEFAULT_KIJI_DB;
  }
  return null;
}

export function logLoadMemoryReport(label: string, memory: LoadMemoryReport): void {
  if (process.env.KIJI_MEMORY_TEST_REPORT !== '1') {
    return;
  }

  process.stderr.write(
    `[memory-test] ${label} articles=${memory.articleCount} heap=${memory.heapUsedMb}MB (+${memory.heapDeltaMb}MB) peak=${memory.peakHeapUsedMb}MB rss=${memory.rssMb}MB (+${memory.rssDeltaMb}MB) serialized=${memory.serializedRetainedKb}KB estStrings=${memory.estimatedStringBytes} faviconRefs=${memory.distinctFaviconRefs} internFeeds=${memory.internedFeedCount} elapsed=${memory.elapsedMs}ms\n`,
  );
}

type DbArticleRow = {
  hash: string;
  feed_id: string;
  title: string;
  description: string;
  link: string | null;
  author: string | null;
  published_date: string | null;
  fetched_date: string;
  read: number;
  starred: number;
  saved: number;
  saved_article_id: string | null;
  last_read_at: string | null;
  metadata_json: string | null;
  feed_url: string | null;
  feed_title: string | null;
  feed_favicon: string | null;
  feed_favicon_has_transparency: number | null;
  feed_favicon_bg_light: string | null;
  feed_favicon_bg_dark: string | null;
  feed_image: string | null;
};

function mapDbRows(rows: DbArticleRow[]): ArticleRecord[] {
  return rows.map((row) => ({
    hash: row.hash,
    feedId: row.feed_id,
    title: row.title,
    description: row.description ?? '',
    content: '',
    link: row.link,
    author: row.author,
    publishedDate: row.published_date,
    fetchedDate: row.fetched_date,
    read: row.read === 1,
    starred: row.starred === 1,
    saved: row.saved === 1,
    savedArticleId: row.saved_article_id,
    lastReadAt: row.last_read_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    feedUrl: row.feed_url,
    feedTitle: row.feed_title,
    feedFavicon: row.feed_favicon,
    feedFaviconHasTransparency: row.feed_favicon_has_transparency === 1
      ? true
      : row.feed_favicon_has_transparency === 0
        ? false
        : null,
    feedFaviconBgLight: row.feed_favicon_bg_light,
    feedFaviconBgDark: row.feed_favicon_bg_dark,
    feedImage: row.feed_image,
  }));
}

function queryKiJiDb(dbPath: string, sql: string): ArticleRecord[] {
  const output = execSync(`sqlite3 -json ${JSON.stringify(dbPath)} ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  if (!output) {
    return [];
  }

  return mapDbRows(JSON.parse(output) as DbArticleRow[]);
}

export function loadArticleRecordsFromKiJiDb(dbPath: string, limit: number): ArticleRecord[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  return queryKiJiDb(dbPath, `
    SELECT
      a.hash, a.feed_id, a.title, a.description, a.link, a.author,
      a.published_date, a.fetched_date, a.read, a.starred, a.saved,
      a.saved_article_id, a.last_read_at, a.metadata_json,
      COALESCE(f.url, a.feed_url) AS feed_url,
      COALESCE(f.title, a.feed_title) AS feed_title,
      COALESCE(f.favicon, a.feed_favicon) AS feed_favicon,
      COALESCE(f.favicon_has_transparency, a.feed_favicon_has_transparency) AS feed_favicon_has_transparency,
      COALESCE(f.favicon_bg_light, a.feed_favicon_bg_light) AS feed_favicon_bg_light,
      COALESCE(f.favicon_bg_dark, a.feed_favicon_bg_dark) AS feed_favicon_bg_dark,
      COALESCE(f.image, a.feed_image) AS feed_image
    FROM articles a
    LEFT JOIN feeds f ON f.id = a.feed_id
    ORDER BY COALESCE(a.published_date, a.fetched_date) DESC, a.hash ASC
    LIMIT ${boundedLimit}
  `);
}

export function loadTechStationRecordsFromKiJiDb(dbPath: string, limit: number): ArticleRecord[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  return queryKiJiDb(dbPath, `
    SELECT
      a.hash, a.feed_id, a.title, a.description, a.link, a.author,
      a.published_date, a.fetched_date, a.read, a.starred, a.saved,
      a.saved_article_id, a.last_read_at, a.metadata_json,
      COALESCE(f.url, a.feed_url) AS feed_url,
      COALESCE(f.title, a.feed_title) AS feed_title,
      COALESCE(f.favicon, a.feed_favicon) AS feed_favicon,
      COALESCE(f.favicon_has_transparency, a.feed_favicon_has_transparency) AS feed_favicon_has_transparency,
      COALESCE(f.favicon_bg_light, a.feed_favicon_bg_light) AS feed_favicon_bg_light,
      COALESCE(f.favicon_bg_dark, a.feed_favicon_bg_dark) AS feed_favicon_bg_dark,
      COALESCE(f.image, a.feed_image) AS feed_image
    FROM articles a
    INNER JOIN feed_tags ft ON ft.feed_id = a.feed_id
    LEFT JOIN feeds f ON f.id = a.feed_id
    WHERE ft.tag_name = 'Tech'
    ORDER BY COALESCE(a.published_date, a.fetched_date) DESC, a.hash ASC
    LIMIT ${boundedLimit}
  `);
}

function roundMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function roundKb(value: number): number {
  return Math.round(value / 1024);
}

function roundPerformanceMs(value: number): number {
  return Math.round(value * 10) / 10;
}
