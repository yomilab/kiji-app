import { logger } from '@/services/logger';
import { savedArticlesSyncEventBus, type SavedArticlesSyncEvent } from './savedArticlesSyncEventBus';

/**
 * Forward saved-article lifecycle events to the main-process folder sync
 * queue once per renderer so file work stays out of the save path.
 */
class SavedArticlesSyncBridge {
  private started = false;

  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.started || !window.electronAPI?.queueSavedArticlesFolderSync) {
      return;
    }

    this.unsubscribe = savedArticlesSyncEventBus.subscribe((event) => {
      void this.forwardEvent(event);
    });
    this.started = true;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
  }

  private forwardEvent(event: SavedArticlesSyncEvent): void {
    // Defer the renderer-to-main IPC hop so save/unsave interactions finish
    // before folder-sync bookkeeping begins.
    window.setTimeout(() => {
      void window.electronAPI?.queueSavedArticlesFolderSync(event).catch((error) => {
        logger.error('SavedArticlesSync', 'Failed to queue saved article folder sync', {
          error,
          event,
        });
      });
    }, 0);
  }
}

export const savedArticlesSyncBridge = new SavedArticlesSyncBridge();
