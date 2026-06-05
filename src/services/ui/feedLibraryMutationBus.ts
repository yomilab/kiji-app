export type FeedLibraryMutation =
  | { type: "feed-created"; feedId: string }
  | { type: "feed-updated"; feedId: string }
  | { type: "feed-deleted"; feedId: string }
  | { type: "articles-refreshed"; feedId: string; insertedCount: number }
  | { type: "article-read-updated"; hash: string; read: boolean }
  | { type: "article-starred-updated"; hash: string; starred: boolean }
  | { type: "article-saved-updated"; hash: string; saved: boolean; savedArticleId?: string };

type FeedLibraryMutationListener = (mutation: FeedLibraryMutation) => void;

class FeedLibraryMutationBus {
  private listeners = new Set<FeedLibraryMutationListener>();

  subscribe(listener: FeedLibraryMutationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(mutation: FeedLibraryMutation): void {
    this.listeners.forEach((listener) => listener(mutation));
  }
}

export const feedLibraryMutationBus = new FeedLibraryMutationBus();
