import { emit, listen } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import { createDeferredUnsubscribe } from '@/services/tauri/tauriEventSubscription';
import {
  invokeSavedArticlesExportPreflight,
  invokeSavedArticlesExportStart,
  invokeSavedArticlesSyncQueue,
  listenSavedArticlesExportEvents,
} from '@/services/saved/savedArticlesIOService';
import {
  helperTaskAdd,
  helperTaskClear,
  helperTaskGetQueueSnapshot,
  helperTaskRemove,
  installHelperTaskService,
  onHelperTaskResult,
} from '@/services/tasks/helperTaskService';
import type {
  HelperTaskAddRequest,
  HelperTaskRemoveRequest,
  HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';
import { articleToRecord, recordToArticle } from '@/stores/articleStore';
import { extractArticleContentFromHtml } from '@/services/articles/articleExtractionService';
import { isContentParser } from '@/services/settings/types';
import type { ElectronAPI } from '@/types/electron';
import type { AppMenuCommand } from '@/types/appMenu';
import { trafficLightVisibilityBus } from '@/services/ui/trafficLightVisibilityBus';

function fileNameFromPath(path: string): string | undefined {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function installElectronApiCompat(): void {
  if (window.electronAPI) {
    return;
  }

  installHelperTaskService();

  let helperTaskListenerInstalled = false;
  const helperTaskListeners = new Set<(event: HelperTaskResultEvent) => void>();

  const ensureHelperTaskListener = (): void => {
    if (helperTaskListenerInstalled) {
      return;
    }

    onHelperTaskResult((event) => {
      for (const listener of helperTaskListeners) {
        listener(event);
      }
    });
    helperTaskListenerInstalled = true;
  };

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
    async hideTrafficLights() {
      trafficLightVisibilityBus.setVisible(false);
    },
    async showTrafficLights() {
      trafficLightVisibilityBus.setVisible(true);
    },
    async openSettings() {
      await tauriClient.shell.openSettings();
    },
    async updateAppMenuState(state) {
      await tauriClient.shell.updateMenuState(state);
    },
    onAppMenuCommand(callback: (command: AppMenuCommand) => void) {
      return createDeferredUnsubscribe(listen<AppMenuCommand>('app-menu:command', (event) => {
        callback(event.payload);
      }));
    },
    async openExternal(url) {
      await tauriClient.shell.openExternal({ url });
    },
    async getSystemAppIconState() {
      return tauriClient.system.appIcon.getState();
    },
    async setSystemAppIconVariant(variant) {
      return tauriClient.system.appIcon.setVariant({ variant });
    },
    async pickSystemAppIcon() {
      return tauriClient.system.appIcon.pick();
    },
    async resetSystemAppIcon() {
      return tauriClient.system.appIcon.reset();
    },
    async relaunchApplication() {
      await tauriClient.system.app.relaunch();
    },
    async openArticleWindow(articleData) {
      await tauriClient.shell.openArticleWindow({
        article: articleToRecord(articleData.article),
      });
      try {
        await emit('article-window:open');
      } catch {
        // Non-Tauri test environments do not expose the event bus.
      }
    },
    async getArticleWindowData() {
      const record = await tauriClient.shell.getArticleWindowData();
      return recordToArticle(record);
    },
    async showShareSheet(shareData) {
      await tauriClient.shell.share(shareData);
    },
    async showImageContextMenu(src) {
      await tauriClient.shell.showImageContextMenu({ src });
    },
    async getShareServices() {
      const services = await tauriClient.shell.listShareServices();
      return services.map((service) => ({
        id: service.id,
        name: service.name,
        icon: service.icon ?? 'share',
      }));
    },
    async shareToService(serviceId, shareData) {
      return tauriClient.shell.shareToService({ ...shareData, serviceId });
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
      return {
        canceled: result.canceled,
        filePath: result.filePath ?? undefined,
      };
    },
    async getSystemAccentColor() {
      return tauriClient.system.theme.getAccentColor();
    },
    onSystemAccentColorChanged(callback: (color: string) => void) {
      return createDeferredUnsubscribe(listen<{ color: string }>('system-accent-color-changed', (event) => {
        callback(event.payload.color);
      }));
    },
    async notifySettingsChanged() {
      try {
        await emit('settings-changed');
      } catch {
        // Non-Tauri test environments do not expose the event bus.
      }
    },
    onSettingsChanged(callback) {
      return createDeferredUnsubscribe(
        listen('settings-changed', () => callback()),
      );
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
    async saveOpmlFile(content, suggestedName) {
      const saveResult = await tauriClient.shell.dialog.saveFile({
        title: 'Export OPML',
        fileName: suggestedName ?? 'Feeds.opml',
        filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }

      await tauriClient.shell.dialog.writeTextFile({
        path: saveResult.filePath,
        content,
      });

      return {
        canceled: false,
        filePath: saveResult.filePath,
      };
    },
    async pickSavedArticlesSyncFolder(defaultPath) {
      return tauriClient.shell.dialog.pickFolder({
        title: 'Choose saved articles folder',
        defaultPath,
      });
    },
    async queueSavedArticlesFolderSync(event) {
      await invokeSavedArticlesSyncQueue(event);
    },
    async pickSavedArticlesExportPath() {
      return tauriClient.shell.dialog.saveFile({
        title: 'Export saved articles',
        fileName: 'Saved Articles.zip',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
    },
    async getSavedArticlesExportPreflight(outputPath) {
      return invokeSavedArticlesExportPreflight(outputPath);
    },
    async startSavedArticlesExport(request) {
      return invokeSavedArticlesExportStart(request.outputPath);
    },
    onSavedArticlesExportEvent(callback) {
      return createDeferredUnsubscribe(listenSavedArticlesExportEvents((event) => {
        callback(event);
      }));
    },
    async parseArticle(url, parser) {
      try {
        const fetchResult = await api.fetchHtmlSafe(url);
        if (fetchResult.resourceType !== 'html') {
          return {
            success: false,
            resourceType: fetchResult.resourceType,
            error: `Non-HTML content type: ${fetchResult.contentType}`,
          };
        }

        const html = fetchResult.html;
        if (!html) {
          return {
            success: false,
            error: 'Failed to fetch article HTML',
          };
        }

        const content = await extractArticleContentFromHtml(
          url,
          html,
          isContentParser(parser) ? parser : undefined,
        );

        if (!content) {
          return {
            success: false,
            error: 'Failed to parse article',
          };
        }

        return {
          success: true,
          content,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    async fetchHtmlSafe(url) {
      return tauriClient.feeds.fetchHtmlSafe({ url });
    },
    async helperTaskAdd(request: HelperTaskAddRequest) {
      return helperTaskAdd(request);
    },
    async helperTaskRemove(request: HelperTaskRemoveRequest) {
      return helperTaskRemove(request);
    },
    async helperTaskClear() {
      return helperTaskClear();
    },
    async helperTaskGetQueueSnapshot() {
      return helperTaskGetQueueSnapshot();
    },
    onHelperTaskResult(callback: (event: HelperTaskResultEvent) => void) {
      ensureHelperTaskListener();
      helperTaskListeners.add(callback);
      return () => {
        helperTaskListeners.delete(callback);
      };
    },
  };

  window.electronAPI = api;
}

export { installElectronApiCompat };
