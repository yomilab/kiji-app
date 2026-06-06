import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/services/logger';
import { userMessageBus } from '@/services/ui/userMessageBus';
import type { SavedArticlesExportEvent } from '@/services/saved/export/shared';

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
        const confirmed = window.confirm(this.buildExportConfirmationMessage(preflight));
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
   * Import saved articles from a ZIP or CSV file.
   * URL extraction/import still depends on helper-task parity tracked in migration todo 16.
   */
  async importSavedArticles(file?: File): Promise<void> {
    logger.info('SavedArticlesIO', 'Saved article import still requires helper-task parity in Tauri', {
      fileName: file?.name,
    });
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
  return invoke<{
    articleCount: number;
    estimatedUncompressedBytes: number;
    estimatedZipBytes: number;
    freeBytes: number | null;
    exceedsOneGb: boolean;
    exceedsFreeSpace: boolean;
  }>('saved_export_preflight', { outputPath });
}

export async function invokeSavedArticlesExportStart(outputPath: string) {
  return invoke<{
    started: boolean;
    jobId?: string;
    reason?: 'busy';
  }>('saved_export_start', { outputPath });
}

export async function invokeSavedArticlesSyncQueue(request: {
  type: 'saved' | 'unsaved';
  savedArticleId: string;
  title: string | null;
}): Promise<void> {
  await invoke('saved_sync_queue', request);
}
