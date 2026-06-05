export type FeedRefreshStatus = "queued" | "refreshing" | "success" | "notModified" | "failed" | "aborted";

export interface FeedRefreshActivity {
  feedId: string;
  status: FeedRefreshStatus;
  timestamp: string;
  insertedCount?: number;
  error?: string;
}

type FeedRefreshActivityListener = (activity: FeedRefreshActivity) => void;

class FeedRefreshActivityBus {
  private listeners = new Set<FeedRefreshActivityListener>();
  private latest = new Map<string, FeedRefreshActivity>();

  subscribe(listener: FeedRefreshActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(activity: Omit<FeedRefreshActivity, "timestamp">): FeedRefreshActivity {
    const snapshot = { ...activity, timestamp: new Date().toISOString() };
    this.latest.set(activity.feedId, snapshot);
    this.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  getLatest(feedId: string): FeedRefreshActivity | undefined {
    return this.latest.get(feedId);
  }

  getAll(): FeedRefreshActivity[] {
    return Array.from(this.latest.values());
  }
}

export const feedRefreshActivityBus = new FeedRefreshActivityBus();
