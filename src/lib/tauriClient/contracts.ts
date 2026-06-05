import type { AppSettings, AppSettingsPatch } from "../settings";

export type ISODateString = string;
export type DataUrlString = string;
export type FilePathString = string;
export type UrlString = string;

export interface NativeCommandError {
  message: string;
  code?: string;
}

export interface DatabaseStatus {
  path: FilePathString;
  schemaVersion: number;
  currentMigrationVersion: number;
  journalMode: string;
  foreignKeysEnabled: boolean;
}

export interface FeedRecord {
  id: string;
  title: string;
  url: UrlString;
  createdAt: ISODateString;
  description: string | null;
  lastFetched: ISODateString | null;
  lastFailedFetchAt: ISODateString | null;
  unreadCount: number;
  articleCount: number;
  tags: string[];
  favicon: DataUrlString | null;
  faviconHasTransparency: boolean | null;
  faviconDominantColor: string | null;
  faviconBgLight: string | null;
  faviconBgDark: string | null;
  faviconFetchFailed: boolean;
  emoji: string | null;
  image: UrlString | null;
  categories: string[];
  language: string | null;
  isPodcast: boolean;
  podcastMetadata: unknown | null;
  readerModeEnabled: boolean;
  etag: string | null;
  lastModifiedHeader: string | null;
  sortOrder: number;
  updateFrequencyScore: number;
  consecutiveFailures: number;
  lastFaviconRefresh: ISODateString | null;
}

export interface TagRecord {
  name: string;
  color: string | null;
  emoji: string | null;
  createdAt: ISODateString;
  sortOrder: number;
  feedIds?: string[];
}

export interface ArticleFeedMetadata {
  feedUrl: UrlString | null;
  feedTitle: string | null;
  feedFavicon: DataUrlString | null;
  feedFaviconHasTransparency: boolean | null;
  feedFaviconBgLight: string | null;
  feedFaviconBgDark: string | null;
  feedImage: UrlString | null;
}

export interface ArticleRecord extends ArticleFeedMetadata {
  hash: string;
  feedId: string;
  title: string;
  description: string;
  content: string;
  link: UrlString | null;
  author: string | null;
  publishedDate: ISODateString | null;
  fetchedDate: ISODateString;
  read: boolean;
  starred: boolean;
  saved: boolean;
  savedArticleId: string | null;
  lastReadAt: ISODateString | null;
  metadata: unknown | null;
}

export interface ArticleQueryRequest {
  feedId?: string;
  tagName?: string;
  feedIds?: string[];
  unreadOnly?: boolean;
  savedOnly?: boolean;
  searchText?: string;
  limit?: number;
  offset?: number;
}

export interface ArticleQueryResponse {
  articles: ArticleRecord[];
  total: number;
  hasMore: boolean;
}

export interface SavedArticleRecord extends ArticleFeedMetadata {
  id: string;
  articleHash: string;
  title: string | null;
  description: string | null;
  content: string | null;
  link: UrlString | null;
  author: string | null;
  publishedDate: ISODateString | null;
  savedDate: ISODateString;
  lastReadAt: ISODateString | null;
  feedId: string | null;
  previewImage: UrlString | null;
  metadata: unknown | null;
  highlights: unknown[];
  notes: string | null;
}

export interface SavedArticleQueryRequest {
  limit?: number;
  offset?: number;
  searchText?: string;
}

export interface SavedArticleQueryResponse {
  articles: SavedArticleRecord[];
  total: number;
}

export interface FeedFetchRequest {
  url: UrlString;
  requestId?: string;
}

export interface FeedFetchWithCacheRequest extends FeedFetchRequest {
  etag?: string;
  lastModified?: string;
  timeout?: number;
}

export interface FeedFetchWithCacheResponse {
  data: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

export interface DialogResult {
  canceled: boolean;
  filePath?: FilePathString;
  fileName?: string;
  content?: string;
}

export interface FolderPickResult {
  canceled: boolean;
  folderPath?: FilePathString;
}

export interface SavedArticlesExportPreflight {
  outputPath: FilePathString;
  articleCount: number;
  estimatedBytes: number;
  warnings: string[];
}

export type SavedArticlesExportEvent =
  | { type: "started"; exportId: string; total: number }
  | { type: "progress"; exportId: string; completed: number; total: number }
  | { type: "completed"; exportId: string; outputPath: FilePathString }
  | { type: "failed"; exportId: string; error: string };

export interface SavedArticlesExportStartRequest {
  outputPath: FilePathString;
}

export interface SavedArticlesExportStartResponse {
  exportId: string;
  started: boolean;
}

export type AppMenuLibraryView = "saved" | "unread" | "all" | null;

export interface AppMenuState {
  theme: AppSettings["theme"];
  libraryView: AppMenuLibraryView;
}

export type AppMenuCommand =
  | { type: "checkUpdates" }
  | { type: "exportFeeds" }
  | { type: "exportSavedArticles" }
  | { type: "clearFeeds" }
  | { type: "clearSavedArticles" }
  | { type: "clearArticlesOlderThan"; months: number }
  | { type: "clearArticles" }
  | { type: "setTheme"; theme: AppSettings["theme"] }
  | { type: "selectLibraryView"; libraryView: Exclude<AppMenuLibraryView, null> }
  | { type: "openAddSubscription" }
  | { type: "importFeeds" };

export interface ArticleWindowPayload {
  article: ArticleRecord;
}

export interface ShareRequest {
  title: string;
  url: UrlString;
}

export interface ShareService {
  id: string;
  name: string;
  icon?: string;
}

export type SystemAppIconVariant = "light" | "dark" | "custom";

export interface SystemAppIconState {
  variant: SystemAppIconVariant;
  customIconPath: FilePathString | null;
  previewPath: FilePathString | null;
  requiresRelaunch: boolean;
}

export interface LogEntryInput {
  level: "debug" | "info" | "warn" | "error";
  process: "renderer" | "main" | "native";
  category: string;
  event: string;
  message: string;
  context?: unknown;
}

export interface PerformanceSnapshot {
  timestamp: ISODateString;
  processes: Array<{
    pid: number;
    type: string;
    cpu: number;
    memoryMb: number;
  }>;
  native: {
    pid: number;
    rssMb: number;
  };
}

export type HelperTaskKind =
  | "article-preprocess"
  | "saved-article-export"
  | "saved-article-url-metadata";

export interface HelperTaskAddRequest<TPayload = unknown> {
  kind: HelperTaskKind;
  dedupeKey?: string;
  payload: TPayload;
}

export interface HelperTaskAddResponse {
  taskId: string;
  queued: boolean;
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
  queued: number;
  running: number;
  maxConcurrent: number;
}

export type HelperTaskResultEvent =
  | { taskId: string; kind: HelperTaskKind; status: "completed"; result: unknown }
  | { taskId: string; kind: HelperTaskKind; status: "failed"; error: string }
  | { taskId: string; kind: HelperTaskKind; status: "cancelled" };

export interface SettingsContract {
  get: {
    response: AppSettings;
  };
  update: {
    request: AppSettingsPatch;
    response: AppSettings;
  };
  reset: {
    response: AppSettings;
  };
}

export interface DatabaseContract {
  getStatus: {
    response: DatabaseStatus;
  };
}

export interface FeedsContract {
  fetch: {
    request: FeedFetchRequest;
    response: string;
  };
  fetchWithCache: {
    request: FeedFetchWithCacheRequest;
    response: FeedFetchWithCacheResponse;
  };
  abortRequest: {
    request: { requestId: string };
    response: void;
  };
  list: {
    response: FeedRecord[];
  };
  tagsList: {
    response: TagRecord[];
  };
}

export interface ArticlesContract {
  query: {
    request: ArticleQueryRequest;
    response: ArticleQueryResponse;
  };
  get: {
    request: { hash: string };
    response: ArticleRecord | null;
  };
  getContent: {
    request: { hash: string };
    response: string | null;
  };
}

export interface SavedContract {
  query: {
    request: SavedArticleQueryRequest;
    response: SavedArticleQueryResponse;
  };
  exportStart: {
    request: SavedArticlesExportStartRequest;
    response: SavedArticlesExportStartResponse;
    event: SavedArticlesExportEvent;
  };
}

export interface ShellContract {
  updateMenuState: {
    request: Partial<AppMenuState>;
    response: void;
    event: AppMenuCommand;
  };
  openExternal: {
    request: { url: UrlString };
    response: void;
  };
  openArticleWindow: {
    request: ArticleWindowPayload;
    response: void;
  };
  share: {
    request: ShareRequest;
    response: { success: boolean };
  };
}

export interface SystemContract {
  appIconGetState: {
    response: SystemAppIconState;
  };
  clipboardReadText: {
    response: string;
  };
  clipboardWriteText: {
    request: { text: string };
    response: void;
  };
}

export interface DiagnosticsContract {
  logWriteEntry: {
    request: LogEntryInput;
    response: void;
  };
  performanceSnapshot: {
    response: PerformanceSnapshot;
  };
  exportBundle: {
    response: { filePath: FilePathString };
  };
}

export interface TasksContract {
  helperAdd: {
    request: HelperTaskAddRequest;
    response: HelperTaskAddResponse;
    event: HelperTaskResultEvent;
  };
  helperRemove: {
    request: HelperTaskRemoveRequest;
    response: HelperTaskRemoveResponse;
  };
  helperClear: {
    response: HelperTaskClearResponse;
  };
  helperGetQueueSnapshot: {
    response: HelperTaskQueueSizeSnapshot;
  };
}
