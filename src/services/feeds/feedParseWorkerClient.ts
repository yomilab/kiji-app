import type { FeedItem } from '@/services/feeds/feedsFetcher';
import { parseFeedWithDiagnostics } from '@/services/feeds/feedsFetcher';
import {
  logFeedParseAttribution,
  type FeedParseAttribution,
} from '@/services/diagnostics/webKitAttribution';

interface WorkerParseRequest {
  id: number;
  rawText: string;
  feedUrl: string;
}

interface WorkerParseSuccess {
  id: number;
  ok: true;
  items: FeedItem[];
  diagnostics: Omit<FeedParseAttribution, "durationMs" | "workerQueueDepth" | "workerPendingCount">;
}

interface WorkerParseFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerParseResponse = WorkerParseSuccess | WorkerParseFailure;

let worker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, {
  resolve: (items: FeedItem[]) => void;
  reject: (error: Error) => void;
  startedAt: number;
  queueDepth: number;
}>();

const ensureWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') {
    return null;
  }

  if (!worker) {
    worker = new Worker(new URL('../../workers/feedParseWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      const response = event.data;
      const pending = pendingRequests.get(response.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(response.id);
      if (response.ok) {
        logFeedParseAttribution({
          ...response.diagnostics,
          durationMs: Math.round(performance.now() - pending.startedAt),
          workerQueueDepth: pending.queueDepth,
          workerPendingCount: pendingRequests.size,
        });
        pending.resolve(response.items);
        return;
      }
      pending.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Feed parse worker failed');
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
      worker?.terminate();
      worker = null;
    };
  }

  return worker;
};

export async function parseFeedOffMainThread(rawText: string, feedUrl: string): Promise<FeedItem[]> {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    const startedAt = performance.now();
    const { items, diagnostics } = parseFeedWithDiagnostics(rawText, feedUrl);
    logFeedParseAttribution({
      ...diagnostics,
      durationMs: Math.round(performance.now() - startedAt),
      workerQueueDepth: 0,
      workerPendingCount: 0,
    });
    return items;
  }

  const id = nextRequestId + 1;
  nextRequestId = id;

  return new Promise<FeedItem[]>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve,
      reject,
      startedAt: performance.now(),
      queueDepth: pendingRequests.size,
    });
    activeWorker.postMessage({
      id,
      rawText,
      feedUrl,
    } satisfies WorkerParseRequest);
  });
}
