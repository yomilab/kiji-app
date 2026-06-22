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

export interface DatabaseContract {
  getStatus: {
    response: DatabaseStatus;
  };
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

export interface FeedCreateRequest {
  feed: FeedRecord;
}

export interface FeedUpdateRequest {
  id: string;
  updates: Partial<Omit<FeedRecord, "id">>;
}

export interface FeedDeleteRequest {
  id: string;
}

export interface FeedCountUpdateRequest {
  id: string;
  count: number;
}

export interface FeedLastFetchedUpdateRequest {
  id: string;
  lastFetched: ISODateString;
}

export interface TagRecord {
  name: string;
  color: string | null;
  emoji: string | null;
  createdAt: ISODateString;
  sortOrder: number;
  feedIds?: string[];
}

export interface TagUpdateRequest {
  name: string;
  updates: Partial<Omit<TagRecord, "name">>;
}

export interface TagRenameRequest {
  currentName: string;
  nextName: string;
}

export interface FeedTagRequest {
  feedId: string;
  tagName: string;
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

export interface FeedArticleCountsRecord {
  feedId: string;
  unreadCount: number;
  articleCount: number;
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

export interface ArticleInsertBatchRequest {
  articles: ArticleRecord[];
}

export interface ArticleReadUpdateRequest {
  hash: string;
  read: boolean;
}

export interface ArticleLastReadAtUpdateRequest {
  hash: string;
  lastReadAt: ISODateString;
}

export interface ArticleSavedStateUpdateRequest {
  hash: string;
  saved: boolean;
  savedArticleId?: string;
}

export interface ArticleCleanOldRequest {
  feedId: string;
  cutoffDate: ISODateString;
}

export interface ArticleCleanOldAcrossFeedsRequest {
  cutoffDate: ISODateString;
}

export interface ArticleFeedMetaUpdateRequest {
  feedId: string;
  meta: Partial<ArticleFeedMetadata>;
}

export interface ArticleQueryRequest {
  feedId?: string;
  tagName?: string;
  feedIds?: string[];
  unreadOnly?: boolean;
  savedOnly?: boolean;
  read?: boolean;
  starred?: boolean;
  saved?: boolean;
  sortField?: "published_date" | "fetched_date";
  sortOrder?: "asc" | "desc";
  searchText?: string;
  limit?: number;
  offset?: number;
  cursorDate?: ISODateString;
  cursorHash?: string;
  includeTotal?: boolean;
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

export interface SavedArticleCreateRequest {
  article: SavedArticleRecord;
}

export interface SavedArticleInsertBatchRequest {
  articles: SavedArticleRecord[];
}

export interface SavedArticleDeleteRequest {
  id: string;
}

export interface SavedArticleHighlightsUpdateRequest {
  id: string;
  highlights: unknown[];
}

export interface SavedArticleNotesUpdateRequest {
  id: string;
  notes: string;
}

export interface SavedArticleLastReadAtUpdateRequest {
  id: string;
  lastReadAt: ISODateString;
}

export interface SavedArticleSyncQueueRequest {
  type: "saved" | "unsaved";
  savedArticleId: string;
  title: string | null;
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

export interface FeedFetchDataUrlRequest extends FeedFetchRequest {
  timeout?: number;
}

export interface FeedFetchDataUrlResponse {
  dataUrl: DataUrlString;
  contentType: string;
  byteLength: number;
}

export interface DialogResult {
  canceled: boolean;
  filePath?: FilePathString;
}

export interface FolderPickResult {
  canceled: boolean;
  folderPath?: FilePathString;
}

export interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenFileDialogRequest {
  title?: string;
  defaultPath?: FilePathString;
  filters?: FileDialogFilter[];
}

export interface ReadTextFileRequest {
  path: FilePathString;
}

export interface WriteTextFileRequest {
  path: FilePathString;
  content: string;
}

export interface SaveFileDialogRequest extends OpenFileDialogRequest {
  fileName?: string;
}

export interface PickFolderDialogRequest {
  title?: string;
  defaultPath?: FilePathString;
}

export interface SavedArticlesExportPreflight {
  articleCount: number;
  estimatedUncompressedBytes: number;
  estimatedZipBytes: number;
  freeBytes: number | null;
  exceedsOneGb: boolean;
  exceedsFreeSpace: boolean;
}

export interface SavedArticlesExportCompletedPayload {
  outputPath: FilePathString;
  articleCount: number;
  writtenBytes: number;
  durationMs: number;
}

export type SavedArticlesExportEvent =
  | {
      jobId: string;
      status: "progress";
      phase: "starting" | "exporting" | "finalizing";
      articleCount: number;
      processedArticles: number;
      writtenBytes?: number;
      message: string;
    }
  | {
      jobId: string;
      status: "completed";
      message: string;
      result: SavedArticlesExportCompletedPayload;
    }
  | {
      jobId: string;
      status: "failed";
      message: string;
      error: string;
    };

export interface SavedArticlesExportStartRequest {
  outputPath: FilePathString;
}

export interface SavedArticlesExportStartResponse {
  started: boolean;
  jobId?: string;
  reason?: "busy";
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
  buttonRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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
  process: "renderer" | "main" | "native" | "worker";
  category: string;
  event?: string;
  message: string;
  context?: unknown;
  error?: unknown;
  timestamp?: ISODateString;
}

export interface PerformanceSnapshot {
  timestamp: ISODateString;
  processes: Array<{
    pid: number;
    name: string;
    type: string;
    cpu: number;
    mem: number;
  }>;
  totals: {
    cpu: number;
    memoryMb: number;
    nativeMemoryMb: number;
    webkitMemoryMb: number;
    processCount: number;
  };
  main: {
    pid: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    handles: number;
    requests: number;
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

export type ArticleResourceType = "html" | "pdf" | "unsupported";

export interface FetchHtmlSafeResponse {
  resourceType: ArticleResourceType;
  contentType: string;
  html?: string;
}

export interface FeedsContract {
  fetch: {
    request: FeedFetchRequest;
    response: string;
  };
  fetchHtmlSafe: {
    request: { url: UrlString; timeout?: number };
    response: FetchHtmlSafeResponse;
  };
  fetchWithCache: {
    request: FeedFetchWithCacheRequest;
    response: FeedFetchWithCacheResponse;
  };
  fetchDataUrl: {
    request: FeedFetchDataUrlRequest;
    response: FeedFetchDataUrlResponse;
  };
  fetchPdfDataUrl: {
    request: FeedFetchDataUrlRequest;
    response: FeedFetchDataUrlResponse;
  };
  abortRequest: {
    request: { requestId: string };
    response: void;
  };
  list: {
    response: FeedRecord[];
  };
  get: {
    request: { id: string };
    response: FeedRecord | null;
  };
  getByUrl: {
    request: { url: UrlString };
    response: FeedRecord | null;
  };
  create: {
    request: FeedCreateRequest;
    response: void;
  };
  update: {
    request: FeedUpdateRequest;
    response: void;
  };
  delete: {
    request: FeedDeleteRequest;
    response: boolean;
  };
  updateUnreadCount: {
    request: FeedCountUpdateRequest;
    response: void;
  };
  updateArticleCount: {
    request: FeedCountUpdateRequest;
    response: void;
  };
  updateLastFetched: {
    request: FeedLastFetchedUpdateRequest;
    response: void;
  };
  count: {
    response: number;
  };
  tagsList: {
    response: TagRecord[];
  };
  tagsListWithFeedIds: {
    response: Array<TagRecord & { feedIds: string[] }>;
  };
  tagsUpsert: {
    request: { tag: TagRecord };
    response: void;
  };
  tagsUpdate: {
    request: TagUpdateRequest;
    response: void;
  };
  tagsRename: {
    request: TagRenameRequest;
    response: void;
  };
  tagsDelete: {
    request: { name: string };
    response: void;
  };
  tagsAttachFeed: {
    request: FeedTagRequest;
    response: void;
  };
  tagsDetachFeed: {
    request: FeedTagRequest;
    response: void;
  };
  tagsListFeedIds: {
    request: { tagName: string };
    response: string[];
  };
  tagsListByFeed: {
    request: { feedId: string };
    response: string[];
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
  exists: {
    request: { hash: string };
    response: boolean;
  };
  insertBatch: {
    request: ArticleInsertBatchRequest;
    response: number;
  };
  updateRead: {
    request: ArticleReadUpdateRequest;
    response: void;
  };
  updateLastReadAt: {
    request: ArticleLastReadAtUpdateRequest;
    response: void;
  };
  toggleStarred: {
    request: { hash: string };
    response: boolean;
  };
  updateSavedState: {
    request: ArticleSavedStateUpdateRequest;
    response: void;
  };
  deleteByFeed: {
    request: { feedId: string };
    response: string[];
  };
  cleanOldByFeed: {
    request: ArticleCleanOldRequest;
    response: number;
  };
  cleanOldAcrossFeeds: {
    request: ArticleCleanOldAcrossFeedsRequest;
    response: number;
  };
  countUnreadByFeed: {
    request: { feedId: string };
    response: number;
  };
  countByFeed: {
    request: { feedId: string };
    response: number;
  };
  syncFeedCountsBatch: {
    request: { feedIds: string[] };
    response: FeedArticleCountsRecord[];
  };
  updateFeedMeta: {
    request: ArticleFeedMetaUpdateRequest;
    response: void;
  };
}

export interface SavedContract {
  query: {
    request: SavedArticleQueryRequest;
    response: SavedArticleQueryResponse;
  };
  create: {
    request: SavedArticleCreateRequest;
    response: void;
  };
  insertBatch: {
    request: SavedArticleInsertBatchRequest;
    response: number;
  };
  delete: {
    request: SavedArticleDeleteRequest;
    response: void;
  };
  get: {
    request: { id: string };
    response: SavedArticleRecord | null;
  };
  getByArticleHash: {
    request: { articleHash: string };
    response: SavedArticleRecord | null;
  };
  getByLink: {
    request: { link: UrlString };
    response: SavedArticleRecord | null;
  };
  listAll: {
    response: SavedArticleRecord[];
  };
  getContent: {
    request: { id: string };
    response: string | null;
  };
  updateHighlights: {
    request: SavedArticleHighlightsUpdateRequest;
    response: void;
  };
  updateNotes: {
    request: SavedArticleNotesUpdateRequest;
    response: void;
  };
  updateLastReadAt: {
    request: SavedArticleLastReadAtUpdateRequest;
    response: void;
  };
  exportPreflight: {
    request: SavedArticlesExportStartRequest;
    response: SavedArticlesExportPreflight;
  };
  exportStart: {
    request: SavedArticlesExportStartRequest;
    response: SavedArticlesExportStartResponse;
    event: SavedArticlesExportEvent;
  };
  syncQueue: {
    request: SavedArticleSyncQueueRequest;
    response: void;
  };
}

export interface ShellContract {
  openSettings: {
    response: void;
  };
  updateMenuState: {
    request: Partial<AppMenuState>;
    response: void;
  };
  showImageContextMenu: {
    request: {
      url: UrlString;
      kind?: "link" | "image";
      windowLabel?: string;
    };
    response: { shown: boolean };
  };
  listShareServices: {
    response: ShareService[];
  };
  shareToService: {
    request: ShareRequest & { serviceId: string };
    response: { success: boolean };
  };
  openExternal: {
    request: { url: UrlString };
    response: void;
  };
  dialogConfirm: {
    request: { title?: string; message: string };
    response: boolean;
  };
  dialogOpenFile: {
    request: OpenFileDialogRequest;
    response: DialogResult;
  };
  readTextFile: {
    request: ReadTextFileRequest;
    response: string;
  };
  writeTextFile: {
    request: WriteTextFileRequest;
    response: void;
  };
  dialogSaveFile: {
    request: SaveFileDialogRequest;
    response: DialogResult;
  };
  dialogPickFolder: {
    request: PickFolderDialogRequest;
    response: FolderPickResult;
  };
  openArticleWindow: {
    request: ArticleWindowPayload;
    response: void;
  };
  getArticleWindowData: {
    response: ArticleRecord;
  };
  share: {
    request: ShareRequest;
    response: { success: boolean };
  };
}

export interface SystemContract {
  appIconGetState: {
    response: {
      iconPath: FilePathString | null;
      previewDataUrl: DataUrlString | null;
      hasCustomIcon: boolean;
      iconVariant: "light" | "dark";
    };
  };
  appIconSetVariant: {
    request: { variant: "light" | "dark" };
    response: SystemContract["appIconGetState"]["response"];
  };
  appIconPick: {
    response: {
      canceled: boolean;
      state: SystemContract["appIconGetState"]["response"];
    };
  };
  appIconReset: {
    response: SystemContract["appIconGetState"]["response"];
  };
  appRelaunch: {
    response: void;
  };
  themeGetAccentColor: {
    response: string | null;
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
  logGetPath: {
    response: FilePathString;
  };
  performanceSnapshot: {
    response: PerformanceSnapshot;
  };
  exportBundle: {
    response: { canceled: boolean; filePath: FilePathString | null };
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
