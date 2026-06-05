import { logger } from '@/services/logger';

class ArticleMigration {
  async migrateIfNeeded(): Promise<void> {
    logger.info('Migration', 'Article migration placeholder checked for Tauri renderer');
  }
}

export const articleMigration = new ArticleMigration();
