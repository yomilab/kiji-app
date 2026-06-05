type Listener = (event: SavedArticlesSyncEvent) => void;

interface SavedArticlesSyncEventBase {
  savedArticleId: string;
  title: string | null;
}

export type SavedArticlesSyncEvent =
  | ({ type: 'saved' } & SavedArticlesSyncEventBase)
  | ({ type: 'unsaved' } & SavedArticlesSyncEventBase);

/**
 * Publish saved-article lifecycle events so follow-up work like folder sync
 * can subscribe without being embedded into the core save/unsave flow.
 */
class SavedArticlesSyncEventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: SavedArticlesSyncEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const savedArticlesSyncEventBus = new SavedArticlesSyncEventBus();
