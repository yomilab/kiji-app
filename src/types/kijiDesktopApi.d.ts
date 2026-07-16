import type { Article } from '@/types/article';
import type { LogEntryInput } from '@/services/logger';
import type { AppMenuCommand, AppMenuState } from '@/types/appMenu';
import type {
  SavedArticlesExportEvent,
  SavedArticlesExportPreflight,
  SavedArticlesExportStartRequest,
  SavedArticlesExportStartResponse,
} from '@/services/saved/export/shared';
import type {
  HelperTaskAddRequest,
  HelperTaskAddResponse,
  HelperTaskClearResponse,
  HelperTaskQueueSizeSnapshot,
  HelperTaskRemoveRequest,
  HelperTaskRemoveResponse,
  HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';

type SystemAppIconVariant = 'light' | 'dark' | 'sunset' | 'sunset-dark' | 'cosmos' | 'cosmos-dark';

export interface KijiDesktopAPI {
  fetchFeed: (url: string, options?: { requestId?: string }) => Promise<string>;
  fetchFeedWithCache: (
    url: string,
    options?: { etag?: string; lastModified?: string; timeout?: number; requestId?: string },
  ) => Promise<{ notModified: boolean; data?: string; etag?: string; lastModified?: string }>;
  abortFeedRequest: (requestId: string) => Promise<void>;
  fetchFavicon: (url: string) => Promise<string>;
  fetchEnhancedFavicon: (url: string) => Promise<string | null>;
  hideTrafficLights: () => Promise<void>;
  showTrafficLights: () => Promise<void>;
  openSettings: () => Promise<void>;
  confirmDialog: (request: { title?: string; message: string }) => Promise<boolean>;
  updateAppMenuState: (state: Partial<AppMenuState>) => Promise<void>;
  onAppMenuCommand: (callback: (command: AppMenuCommand) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  getSystemAppIconState: () => Promise<{
    iconPath: string | null;
    previewDataUrl: string | null;
    hasCustomIcon: boolean;
    iconVariant: SystemAppIconVariant;
  }>;
  setSystemAppIconVariant: (variant: SystemAppIconVariant) => Promise<{
    iconPath: string | null;
    previewDataUrl: string | null;
    hasCustomIcon: boolean;
    iconVariant: SystemAppIconVariant;
  }>;
  pickSystemAppIcon: () => Promise<{
    canceled: boolean;
    state: {
      iconPath: string | null;
      previewDataUrl: string | null;
      hasCustomIcon: boolean;
      iconVariant: SystemAppIconVariant;
    };
  }>;
  resetSystemAppIcon: () => Promise<{
    iconPath: string | null;
    previewDataUrl: string | null;
    hasCustomIcon: boolean;
    iconVariant: SystemAppIconVariant;
  }>;
  relaunchApplication: () => Promise<void>;
  openArticleWindow: (articleData: { article: Article }) => Promise<void>;
  getArticleWindowData: () => Promise<Article>;
  showShareSheet: (shareData: { title: string; url: string; buttonRect?: { x: number; y: number; width: number; height: number } }) => Promise<void>;
  showImageContextMenu: (
    request: string | { url: string; kind?: 'link' | 'image'; windowLabel?: string },
  ) => Promise<void>;
  getShareServices: () => Promise<Array<{ id: string; name: string; icon: string }>>;
  shareToService: (serviceId: string, shareData: { title: string; url: string }) => Promise<{ success: boolean }>;
  storageGet: (key: string) => Promise<string | null>;
  storageSet: (key: string, value: string) => Promise<void>;
  storageRemove: (key: string) => Promise<void>;
  storageClear: () => Promise<void>;
  storageGetAllKeys: () => Promise<string[]>;
  logEntry: (entry: LogEntryInput) => Promise<void>;
  getLogsPath: () => Promise<string>;
  perfSnapshot: () => Promise<any>;
  exportDiagnostics: () => Promise<{ canceled: boolean; filePath?: string }>;
  getSystemAccentColor: () => Promise<string | null>;
  onSystemAccentColorChanged: (callback: (color: string) => void) => void;
  notifySettingsChanged: () => Promise<void>;
  onSettingsChanged: (callback: () => void) => () => void;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  openOpmlFile: () => Promise<{ canceled: boolean; filePath?: string; fileName?: string; content?: string }>;
  saveOpmlFile: (content: string, suggestedName?: string) => Promise<{ canceled: boolean; filePath?: string }>;
  pickSavedArticlesSyncFolder: (defaultPath?: string) => Promise<{ canceled: boolean; folderPath?: string }>;
  queueSavedArticlesFolderSync: (request: { type: 'saved' | 'unsaved'; savedArticleId: string; title: string | null }) => Promise<void>;
  pickSavedArticlesExportPath: () => Promise<{ canceled: boolean; filePath?: string }>;
  getSavedArticlesExportPreflight: (outputPath: string) => Promise<SavedArticlesExportPreflight>;
  startSavedArticlesExport: (request: SavedArticlesExportStartRequest) => Promise<SavedArticlesExportStartResponse>;
  onSavedArticlesExportEvent: (callback: (event: SavedArticlesExportEvent) => void) => () => void;
  parseArticle: (url: string, parser?: string) => Promise<{
    success: boolean;
    resourceType?: 'html' | 'pdf' | 'unsupported';
    content?: {
      title: string | null;
      author: string | null;
      datePublished: string | null;
      siteName: string | null;
      excerpt: string | null;
      content: string | null;
      leadImageUrl: string | null;
      url: string;
      domain: string | null;
      wordCount: number;
    };
    error?: string;
  }>;
  fetchHtmlSafe: (url: string) => Promise<{
    resourceType: 'html' | 'pdf' | 'unsupported';
    contentType: string;
    html?: string;
  }>;
  helperTaskAdd: (request: HelperTaskAddRequest) => Promise<HelperTaskAddResponse>;
  helperTaskRemove: (request: HelperTaskRemoveRequest) => Promise<HelperTaskRemoveResponse>;
  helperTaskClear: () => Promise<HelperTaskClearResponse>;
  helperTaskGetQueueSnapshot: () => Promise<HelperTaskQueueSizeSnapshot>;
  onHelperTaskResult: (callback: (event: HelperTaskResultEvent) => void) => () => void;
}

declare global {
  interface Window {
    kijiAPI: KijiDesktopAPI;
  }
}
