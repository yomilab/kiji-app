export const HELPER_TASK_PRIORITIES = ['high', 'normal', 'low'] as const;

export type HelperTaskPriority = (typeof HELPER_TASK_PRIORITIES)[number];

import type { ContentParser } from '@/services/articles/extractors/types';

export const HELPER_TASK_KIND = {
  OPML_PARSE: 'opml-parse',
  FAVICON_FETCH: 'favicon-fetch',
  SAVED_ARTICLES_EXPORT: 'saved-articles-export',
  SAVED_ARTICLES_IMPORT: 'saved-articles-import',
  SAVED_ARTICLES_CSV_PARSE: 'saved-articles-csv-parse',
  SAVED_ARTICLES_URL_FETCH: 'saved-articles-url-fetch',
  SAVED_ARTICLES_BULK_URL_FETCH: 'saved-articles-bulk-url-fetch',
  ARTICLE_VIEW_PREPROCESS: 'article-view-preprocess',
} as const;

export type HelperTaskKind = (typeof HELPER_TASK_KIND)[keyof typeof HELPER_TASK_KIND];

export interface ParsedOpmlEntry {
  url: string;
  title?: string;
  station?: string;
  emoji?: string;
  stationEmoji?: string;
  rootOutlineIndex?: number;
}

export interface OpmlParseTaskPayload {
  opmlText: string;
  defaultStationName?: string;
  fileName?: string;
  url?: string;
}

export interface OpmlParseTaskResult {
  entries: ParsedOpmlEntry[];
}

export interface FaviconFetchTaskPayload {
  feedId: string;
  feedUrl: string;
}

export interface FaviconFetchTaskResult {
  feedId: string;
  favicon: string | null;
}

export interface ExportArticleData {
  title: string;
  link: string;
  content?: string;
  description?: string;
  savedDate?: string;
  fetchedDate?: string;
}

export interface SavedArticlesExportTaskPayload {
  articles: ExportArticleData[];
}

export interface SavedArticlesExportTaskResult {
  zipArrayBuffer: Uint8Array;
}

export interface SavedArticlesImportTaskPayload {
  zipArrayBuffer: Uint8Array;
}

export interface SavedArticlesImportTaskResult {
  articles: Array<{
    title: string;
    url: string;
    timeAdded: number;
    tags: string[];
    status: string;
    content?: string;
  }>;
}

export interface SavedArticlesCsvParseTaskPayload {
  csvText: string;
}

export interface SavedArticlesCsvParseTaskResult {
  urls: string[];
}

export interface SavedArticlesUrlFetchTaskPayload {
  url: string;
  parser?: ContentParser;
}

export interface SavedArticlesUrlFetchTaskResult {
  url: string;
  title: string | null;
  author: string | null;
  datePublished: string | null;
  content: string | null;
  excerpt: string | null;
  leadImageUrl: string | null;
  domain: string | null;
}

export interface SavedArticlesBulkUrlFetchTaskPayload {
  urls: string[];
  concurrency?: number;
  parser?: ContentParser;
}

export interface SavedArticlesBulkUrlFetchTaskResult {
  results: SavedArticlesUrlFetchTaskResult[];
}

export interface ArticleViewPreprocessTaskPayload {
  html: string;
  baseUrl?: string;
}

export interface ArticleViewPreprocessTaskResult {
  html: string;
}

export interface HelperTaskPayloadMap {
  [HELPER_TASK_KIND.OPML_PARSE]: OpmlParseTaskPayload;
  [HELPER_TASK_KIND.FAVICON_FETCH]: FaviconFetchTaskPayload;
  [HELPER_TASK_KIND.SAVED_ARTICLES_EXPORT]: SavedArticlesExportTaskPayload;
  [HELPER_TASK_KIND.SAVED_ARTICLES_IMPORT]: SavedArticlesImportTaskPayload;
  [HELPER_TASK_KIND.SAVED_ARTICLES_CSV_PARSE]: SavedArticlesCsvParseTaskPayload;
  [HELPER_TASK_KIND.SAVED_ARTICLES_URL_FETCH]: SavedArticlesUrlFetchTaskPayload;
  [HELPER_TASK_KIND.SAVED_ARTICLES_BULK_URL_FETCH]: SavedArticlesBulkUrlFetchTaskPayload;
  [HELPER_TASK_KIND.ARTICLE_VIEW_PREPROCESS]: ArticleViewPreprocessTaskPayload;
}

export interface HelperTaskResultMap {
  [HELPER_TASK_KIND.OPML_PARSE]: OpmlParseTaskResult;
  [HELPER_TASK_KIND.FAVICON_FETCH]: FaviconFetchTaskResult;
  [HELPER_TASK_KIND.SAVED_ARTICLES_EXPORT]: SavedArticlesExportTaskResult;
  [HELPER_TASK_KIND.SAVED_ARTICLES_IMPORT]: SavedArticlesImportTaskResult;
  [HELPER_TASK_KIND.SAVED_ARTICLES_CSV_PARSE]: SavedArticlesCsvParseTaskResult;
  [HELPER_TASK_KIND.SAVED_ARTICLES_URL_FETCH]: SavedArticlesUrlFetchTaskResult;
  [HELPER_TASK_KIND.SAVED_ARTICLES_BULK_URL_FETCH]: SavedArticlesBulkUrlFetchTaskResult;
  [HELPER_TASK_KIND.ARTICLE_VIEW_PREPROCESS]: ArticleViewPreprocessTaskResult;
}

export interface HelperTaskExecutionInput<K extends HelperTaskKind = HelperTaskKind> {
  taskId: string;
  kind: K;
  payload: HelperTaskPayloadMap[K];
}

export type HelperTaskAnyPayload = HelperTaskPayloadMap[HelperTaskKind];
export type HelperTaskAnyResult = HelperTaskResultMap[HelperTaskKind];

export interface HelperTaskAddRequest<K extends HelperTaskKind = HelperTaskKind> {
  id?: string;
  kind: K;
  priority?: HelperTaskPriority;
  payload: HelperTaskPayloadMap[K];
}

export interface HelperTaskAddResponse {
  accepted: boolean;
  taskId: string;
}

export interface HelperTaskRemoveRequest {
  taskId: string;
}

export interface HelperTaskRemoveResponse {
  removed: boolean;
}

export interface HelperTaskClearResponse {
  cleared: number;
}

export interface HelperTaskQueueSizeSnapshot {
  high: number;
  normal: number;
  low: number;
  running: number;
}

interface HelperTaskBaseEvent {
  taskId: string;
  kind: HelperTaskKind;
  priority: HelperTaskPriority;
  durationMs: number;
}

export interface HelperTaskCompletedEvent extends HelperTaskBaseEvent {
  status: 'completed';
  result: HelperTaskAnyResult;
}

export interface HelperTaskFailedEvent extends HelperTaskBaseEvent {
  status: 'failed';
  error: string;
}

export interface HelperTaskCancelledEvent extends HelperTaskBaseEvent {
  status: 'cancelled';
}

export type HelperTaskResultEvent =
  | HelperTaskCompletedEvent
  | HelperTaskFailedEvent
  | HelperTaskCancelledEvent;
