import { getCurrentWindow, Window as TauriWindow } from '@tauri-apps/api/window';
import { tauriClient } from '@/lib/tauriClient';
import type { Article } from '@/types/article';
import type { ElectronAPI } from '@/types/electron';
import type { AppMenuCommand } from '@/types/appMenu';

const ARTICLE_WINDOW_PAYLOAD_KEY = 'kiji:tauri:article-window-payload';
const SYSTEM_APP_ICON_STATE_KEY = 'kiji:tauri:system-app-icon-state';
const settingsChangedListeners = new Set<() => void>();

type SystemAppIconVariant = 'light' | 'dark';
type SystemAppIconState = {
  iconPath: string | null;
  previewDataUrl: string | null;
  hasCustomIcon: boolean;
  iconVariant: SystemAppIconVariant;
};

const defaultIconState = (variant: SystemAppIconVariant = 'dark'): SystemAppIconState => ({
  iconPath: null,
  previewDataUrl: null,
  hasCustomIcon: false,
  iconVariant: variant,
});

function normalizeSystemAppIconState(value: unknown): SystemAppIconState {
  if (!value || typeof value !== 'object') {
    return defaultIconState();
  }

  const candidate = value as Partial<SystemAppIconState>;
  return {
    iconPath: typeof candidate.iconPath === 'string' ? candidate.iconPath : null,
    previewDataUrl: typeof candidate.previewDataUrl === 'string' ? candidate.previewDataUrl : null,
    hasCustomIcon: Boolean(candidate.hasCustomIcon),
    iconVariant: candidate.iconVariant === 'light' ? 'light' : 'dark',
  };
}

function readStoredSystemAppIconState(): SystemAppIconState {
  try {
    const raw = localStorage.getItem(SYSTEM_APP_ICON_STATE_KEY);
    return raw ? normalizeSystemAppIconState(JSON.parse(raw)) : defaultIconState();
  } catch {
    return defaultIconState();
  }
}

function persistSystemAppIconState(state: SystemAppIconState): SystemAppIconState {
  const normalized = normalizeSystemAppIconState(state);
  localStorage.setItem(SYSTEM_APP_ICON_STATE_KEY, JSON.stringify(normalized));
  return normalized;
}

function fileNameFromPath(path: string): string | undefined {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

async function showWindow(label: string): Promise<void> {
  const window = await TauriWindow.getByLabel(label);
  if (!window) {
    throw new Error(`Tauri window not found: ${label}`);
  }
  await window.show();
  await window.setFocus();
}

async function toggleMaximize(): Promise<void> {
  const currentWindow = getCurrentWindow();
  if (await currentWindow.isMaximized()) {
    await currentWindow.unmaximize();
    return;
  }
  await currentWindow.maximize();
}

function readArticlePayload(): Article {
  const serialized = localStorage.getItem(ARTICLE_WINDOW_PAYLOAD_KEY);
  if (!serialized) {
    throw new Error('No article payload was provided for the Tauri article window.');
  }
  return JSON.parse(serialized) as Article;
}

function installElectronApiCompat(): void {
  if (window.electronAPI) {
    return;
  }

  const api: ElectronAPI = {
    async fetchFeed(url, options) {
      return tauriClient.feeds.fetch({ url, requestId: options?.requestId });
    },
    async fetchFeedWithCache(url, options) {
      const response = await tauriClient.feeds.fetchWithCache({
        url,
        requestId: options?.requestId,
        etag: options?.etag,
        lastModified: options?.lastModified,
        timeout: options?.timeout,
      });
      return {
        notModified: response.notModified,
        data: response.data ?? undefined,
        etag: response.etag ?? undefined,
        lastModified: response.lastModified ?? undefined,
      };
    },
    async abortFeedRequest(requestId) {
      await tauriClient.feeds.abortRequest({ requestId });
    },
    async fetchFavicon(url) {
      return (await tauriClient.feeds.fetchDataUrl({ url })).dataUrl;
    },
    async fetchEnhancedFavicon(url) {
      try {
        return (await tauriClient.feeds.fetchDataUrl({ url })).dataUrl;
      } catch {
        return null;
      }
    },
    async windowMinimize() {
      await getCurrentWindow().minimize();
    },
    windowMaximize: toggleMaximize,
    async windowClose() {
      await getCurrentWindow().close();
    },
    async hideTrafficLights() {},
    async showTrafficLights() {},
    async openSettings() {
      await showWindow('settings');
    },
    async updateAppMenuState() {},
    onAppMenuCommand(_callback: (command: AppMenuCommand) => void) {
      return () => {};
    },
    async openExternal(url) {
      await tauriClient.shell.openExternal({ url });
    },
    async getSystemAppIconState() {
      return readStoredSystemAppIconState();
    },
    async setSystemAppIconVariant(variant) {
      return persistSystemAppIconState({
        ...defaultIconState(variant),
        iconVariant: variant,
      });
    },
    async pickSystemAppIcon() {
      return { canceled: true, state: readStoredSystemAppIconState() };
    },
    async resetSystemAppIcon() {
      const { iconVariant } = readStoredSystemAppIconState();
      return persistSystemAppIconState(defaultIconState(iconVariant));
    },
    async relaunchApplication() {
      window.location.reload();
    },
    async openArticleWindow(articleData) {
      localStorage.setItem(ARTICLE_WINDOW_PAYLOAD_KEY, JSON.stringify(articleData.article));
      await showWindow('article');
    },
    async getArticleWindowData() {
      return readArticlePayload();
    },
    async showShareSheet(shareData) {
      if (shareData.url) {
        await tauriClient.system.clipboard.writeText({ text: shareData.url });
      }
    },
    async showImageContextMenu() {},
    async getShareServices() {
      return [];
    },
    async shareToService() {
      return { success: false };
    },
    async storageGet(key) {
      return localStorage.getItem(key);
    },
    async storageSet(key, value) {
      localStorage.setItem(key, value);
    },
    async storageRemove(key) {
      localStorage.removeItem(key);
    },
    async storageClear() {
      localStorage.clear();
    },
    async storageGetAllKeys() {
      return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null);
    },
    async logEntry(entry) {
      await tauriClient.diagnostics.logWriteEntry(entry);
    },
    async getLogsPath() {
      return tauriClient.diagnostics.logGetPath();
    },
    async perfSnapshot() {
      return tauriClient.diagnostics.performanceSnapshot();
    },
    async exportDiagnostics() {
      const result = await tauriClient.diagnostics.exportBundle();
      return { canceled: false, filePath: result.filePath };
    },
    async getSystemAccentColor() {
      return null;
    },
    onSystemAccentColorChanged() {},
    async notifySettingsChanged() {
      settingsChangedListeners.forEach((listener) => listener());
    },
    onSettingsChanged(callback) {
      settingsChangedListeners.add(callback);
      return () => {
        settingsChangedListeners.delete(callback);
      };
    },
    async readClipboard() {
      return tauriClient.system.clipboard.readText();
    },
    async writeClipboard(text) {
      await tauriClient.system.clipboard.writeText({ text });
    },
    async openOpmlFile() {
      const result = await tauriClient.shell.dialog.openFile({
        title: 'Import OPML',
        filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const content = await tauriClient.shell.dialog.readTextFile({ path: result.filePath });
      return {
        canceled: false,
        filePath: result.filePath,
        fileName: fileNameFromPath(result.filePath),
        content,
      };
    },
    async saveOpmlFile(_content, suggestedName) {
      return tauriClient.shell.dialog.saveFile({
        title: 'Export OPML',
        fileName: suggestedName ?? 'Feeds.opml',
        filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      });
    },
    async pickSavedArticlesSyncFolder(defaultPath) {
      return tauriClient.shell.dialog.pickFolder({
        title: 'Choose saved articles folder',
        defaultPath,
      });
    },
    async queueSavedArticlesFolderSync() {},
    async pickSavedArticlesExportPath() {
      return tauriClient.shell.dialog.saveFile({
        title: 'Export saved articles',
        fileName: 'Saved Articles.zip',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
    },
    async getSavedArticlesExportPreflight(outputPath) {
      void outputPath;
      return {
        articleCount: 0,
        estimatedUncompressedBytes: 0,
        estimatedZipBytes: 0,
        freeBytes: null,
        exceedsOneGb: false,
        exceedsFreeSpace: false,
      };
    },
    async startSavedArticlesExport() {
      return { started: false };
    },
    onSavedArticlesExportEvent() {
      return () => {};
    },
    async parseArticle(url) {
      return {
        success: false,
        resourceType: 'unsupported',
        error: `Article parsing is not yet implemented in the Tauri compatibility layer for ${url}.`,
      };
    },
    async fetchHtmlSafe(url) {
      const html = await tauriClient.feeds.fetch({ url });
      return { resourceType: 'html', contentType: 'text/html', html };
    },
    async helperTaskAdd() {
      return { accepted: false };
    },
    async helperTaskRemove() {
      return { removed: false };
    },
    async helperTaskClear() {
      return { cleared: true };
    },
    async helperTaskGetQueueSnapshot() {
      return { pending: 0, running: 0 };
    },
    onHelperTaskResult() {
      return () => {};
    },
  };

  window.electronAPI = api;
}

export { installElectronApiCompat, ARTICLE_WINDOW_PAYLOAD_KEY };
