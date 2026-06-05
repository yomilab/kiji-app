import { logger } from '@/services/logger';

class SavedArticlesIOService {
  async importSavedArticles(file?: File): Promise<void> {
    logger.info('SavedArticles', 'Saved article import is not yet implemented in Tauri UI port', {
      fileName: file?.name,
    });
  }

  async exportSavedArticles(): Promise<void> {
    logger.info('SavedArticles', 'Saved article export is not yet implemented in Tauri UI port');
  }

  async chooseSyncFolder(defaultPath?: string): Promise<string | null> {
    const result = await window.electronAPI.pickSavedArticlesSyncFolder(defaultPath);
    return result.canceled ? null : result.folderPath ?? null;
  }
}

export const savedArticlesIOService = new SavedArticlesIOService();
