import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import type { SavedArticleRecord } from '@/lib/tauriClient/contracts';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';
import { logger } from '@/services/logger';
import { settingsManager } from '@/services/settings';
import { confirmDialog } from '@/services/ui/confirmDialogService';
import { userMessageBus } from '@/services/ui/userMessageBus';
import type { SavedArticlesExportEvent } from '@/services/saved/export/shared';
import { helperTaskClient } from '@/services/tasks/helperTaskClient';
import { HELPER_TASK_KIND } from '@/services/tasks/helperTaskContracts';

class SavedArticlesIOService {
  private activeExportJobId: string | null = null;
  private hasBoundExportListener = false;

  /**
   * Export all saved articles to a ZIP file using a background Rust export job.
   */
  async exportSavedArticles(): Promise<void> {
    this.ensureExportListener();

    if (!window.electronAPI?.pickSavedArticlesExportPath) {
      logger.error('SavedArticlesIO', 'Saved articles export is only available in the desktop app');
      return;
    }

    try {
      const pathResult = await window.electronAPI.pickSavedArticlesExportPath();
      if (pathResult.canceled || !pathResult.filePath) {
        return;
      }

      const preflight = await window.electronAPI.getSavedArticlesExportPreflight(pathResult.filePath);
      if (preflight.articleCount === 0) {
        userMessageBus.publish('export-progress', 'No saved articles', { durationMs: 4000 });
        return;
      }

      if (preflight.exceedsOneGb || preflight.exceedsFreeSpace) {
        const confirmed = await confirmDialog({
          title: 'Export saved articles',
          message: this.buildExportConfirmationMessage(preflight),
        });
        if (!confirmed) {
          return;
        }
      }

      userMessageBus.publish(
        'export-progress',
        `Preparing export (${preflight.articleCount})`,
      );

      const startResult = await window.electronAPI.startSavedArticlesExport({
        outputPath: pathResult.filePath,
      });

      if (!startResult.started || !startResult.jobId) {
        const message = startResult.reason === 'busy'
          ? 'Export already running'
          : 'Could not start export';
        userMessageBus.publish('export-progress', message, { durationMs: 5000 });
        logger.warn('SavedArticlesIO', message);
        return;
      }

      this.activeExportJobId = startResult.jobId;
      logger.info('SavedArticlesIO', `Started background export job ${startResult.jobId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      userMessageBus.publish('export-progress', 'Export failed', { durationMs: 6000 });
      logger.error('SavedArticlesIO', 'Failed to export saved articles', {
        message: errorMessage,
        error,
      });
    }
  }

  /**
   * Import saved articles from a ZIP or CSV file using background helper tasks.
   */
  async importSavedArticles(file: File): Promise<void> {
    const fileName = file.name.toLowerCase();
    const isCsv = fileName.endsWith('.csv');
    const isZip = fileName.endsWith('.zip');

    if (!isCsv && !isZip) {
      logger.error('SavedArticlesIO', 'Unsupported file format for import. Please use .zip or .csv');
      return;
    }

    try {
      if (isZip) {
        const buffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        const result = await helperTaskClient.runTask({
          kind: HELPER_TASK_KIND.SAVED_ARTICLES_IMPORT,
          payload: { zipArrayBuffer: uint8Array },
        });

        if (result.articles.length === 0) {
          logger.warn('SavedArticlesIO', 'No articles found in import file');
          return;
        }

        const rows: SavedArticleRecord[] = result.articles.map((article): SavedArticleRecord => ({
          id: `saved-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          articleHash: article.url,
          title: article.title || null,
          description: article.content ? null : 'Imported article',
          content: article.content || null,
          link: article.url || null,
          author: null,
          publishedDate: new Date(article.timeAdded * 1000).toISOString(),
          savedDate: new Date(article.timeAdded * 1000).toISOString(),
          lastReadAt: null,
          feedId: 'saved',
          feedUrl: article.url || null,
          feedTitle: null,
          feedFavicon: null,
          feedFaviconHasTransparency: null,
          feedFaviconBgLight: null,
          feedFaviconBgDark: null,
          feedImage: null,
          previewImage: null,
          metadata: null,
          highlights: [],
          notes: null,
        }));

        await tauriClient.saved.insertBatch({ articles: rows });
        logger.info('SavedArticlesIO', `Successfully imported ${rows.length} articles from ZIP`);
      } else if (isCsv) {
        const csvText = await file.text();
        const { urls } = await helperTaskClient.runTask({
          kind: HELPER_TASK_KIND.SAVED_ARTICLES_CSV_PARSE,
          payload: { csvText },
        });

        if (urls.length === 0) {
          logger.warn('SavedArticlesIO', 'No valid URLs found in CSV');
          return;
        }

        logger.info('SavedArticlesIO', `Importing ${urls.length} URLs in chunks`);

        let parser: import('@/services/articles/extractors/types').ContentParser | undefined;
        try {
          parser = (await settingsManager.getSettings()).contentParser;
        } catch (error) {
          logger.warn('SavedArticlesIO', 'Failed to read content parser preference; using default', { error });
        }

        const chunkSize = 20;
        for (let index = 0; index < urls.length; index += chunkSize) {
          const chunk = urls.slice(index, index + chunkSize);
          await this.importUrlChunk(chunk, parser);
        }
      }
    } catch (error) {
      logger.error('SavedArticlesIO', 'Failed to import saved articles', { error });
    }
  }

  private async importUrlChunk(
    urls: string[],
    parser?: import('@/services/articles/extractors/types').ContentParser,
  ): Promise<void> {
    try {
      const { results } = await helperTaskClient.runTask({
        kind: HELPER_TASK_KIND.SAVED_ARTICLES_BULK_URL_FETCH,
        priority: 'low',
        payload: { urls, concurrency: 3, parser },
      });

      if (results.length === 0) return;

      const rows: SavedArticleRecord[] = results.map((metadata): SavedArticleRecord => {
        const now = new Date();
        const nowIso = now.toISOString();
        return {
          id: `saved-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          articleHash: metadata.url,
          title: metadata.title || metadata.url,
          description: metadata.excerpt || null,
          content: metadata.content || null,
          link: metadata.url || null,
          author: metadata.author || null,
          publishedDate: normalizePublishedDate(metadata.datePublished || undefined, { now }) || nowIso,
          savedDate: nowIso,
          lastReadAt: null,
          feedId: 'saved',
          feedUrl: metadata.url || null,
          feedTitle: metadata.domain || null,
          feedFavicon: null,
          feedFaviconHasTransparency: null,
          feedFaviconBgLight: null,
          feedFaviconBgDark: null,
          feedImage: null,
          previewImage: metadata.leadImageUrl || null,
          metadata: null,
          highlights: [],
          notes: null,
        };
      });

      await tauriClient.saved.insertBatch({ articles: rows });
      logger.info('SavedArticlesIO', `Successfully imported chunk of ${rows.length} URLs`);
    } catch (error) {
      logger.error('SavedArticlesIO', 'Failed to background import URL chunk', { error });
    }
  }

  async chooseSyncFolder(defaultPath?: string): Promise<string | null> {
    const result = await window.electronAPI.pickSavedArticlesSyncFolder(defaultPath);
    return result.canceled ? null : result.folderPath ?? null;
  }

  private ensureExportListener(): void {
    if (this.hasBoundExportListener || !window.electronAPI?.onSavedArticlesExportEvent) {
      return;
    }

    window.electronAPI.onSavedArticlesExportEvent((event) => {
      this.handleExportEvent(event);
    });
    this.hasBoundExportListener = true;
  }

  private handleExportEvent(event: SavedArticlesExportEvent): void {
    if (this.activeExportJobId && event.jobId !== this.activeExportJobId) {
      return;
    }

    if (event.status === 'progress') {
      userMessageBus.publish('export-progress', event.message);
      return;
    }

    if (event.status === 'completed') {
      this.activeExportJobId = null;
      userMessageBus.publish(
        'export-progress',
        `Export complete (${event.result.articleCount})`,
        { durationMs: 6000 },
      );
      logger.info('SavedArticlesIO', 'Saved articles export completed', event.result);
      return;
    }

    this.activeExportJobId = null;
    userMessageBus.publish('export-progress', event.message, { durationMs: 7000 });
    logger.error('SavedArticlesIO', 'Saved articles export failed', { error: event.error });
  }

  private buildExportConfirmationMessage(preflight: {
    articleCount: number;
    estimatedZipBytes: number;
    freeBytes: number | null;
    exceedsOneGb: boolean;
    exceedsFreeSpace: boolean;
  }): string {
    const reasons: string[] = [];

    if (preflight.exceedsOneGb) {
      reasons.push(`estimated ZIP size is ${this.formatBytes(preflight.estimatedZipBytes)}`);
    }

    if (preflight.exceedsFreeSpace) {
      reasons.push(
        `available disk space is ${preflight.freeBytes === null ? 'unknown' : this.formatBytes(preflight.freeBytes)}`,
      );
    }

    return [
      `Export ${preflight.articleCount} saved articles?`,
      '',
      `Estimated ZIP size: ${this.formatBytes(preflight.estimatedZipBytes)}`,
      `Free disk space: ${preflight.freeBytes === null ? 'Unknown' : this.formatBytes(preflight.freeBytes)}`,
      '',
      reasons.length > 0 ? `Warning: ${reasons.join(', ')}.` : 'This export may take a while.',
    ].join('\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

export const savedArticlesIOService = new SavedArticlesIOService();

export async function listenSavedArticlesExportEvents(
  callback: (event: SavedArticlesExportEvent) => void,
): Promise<UnlistenFn> {
  return listen<SavedArticlesExportEvent>('saved-articles-export:event', (event) => {
    callback(event.payload);
  });
}

export async function invokeSavedArticlesExportPreflight(outputPath: string) {
  return tauriClient.saved.exportPreflight({ outputPath });
}

export async function invokeSavedArticlesExportStart(outputPath: string) {
  return tauriClient.saved.exportStart({ outputPath });
}

export async function invokeSavedArticlesSyncQueue(request: {
  type: 'saved' | 'unsaved';
  savedArticleId: string;
  title: string | null;
}): Promise<void> {
  await tauriClient.saved.syncQueue(request);
}
