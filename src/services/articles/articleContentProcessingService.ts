import { helperTaskClient } from '@/services/tasks/helperTaskClient';
import {
  HELPER_TASK_KIND,
  type ArticleViewPreprocessTaskPayload,
  type ArticleViewPreprocessTaskResult,
  type HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';

const createAbortError = (): Error => {
  const error = new Error('Article content preprocessing cancelled');
  error.name = 'AbortError';
  return error;
};

const createTaskId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `article-preprocess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

interface RunningArticleContentTask {
  taskId: string;
  promise: Promise<ArticleViewPreprocessTaskResult>;
  cancel: () => Promise<void>;
}

const MAX_CACHE_SIZE = 8;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const HASH_SEED = 2166136261;
const HASH_PRIME = 16777619;

const estimateResultBytes = (result: ArticleViewPreprocessTaskResult): number =>
  result.html.length * 2;

const hashCacheKey = (value: string): string => {
  let hash = HASH_SEED;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }

  return (hash >>> 0).toString(36);
};

class ArticleContentProcessingService {
  private cache = new Map<string, ArticleViewPreprocessTaskResult>();
  private cacheBytes = 0;

  private buildCacheKey(payload: ArticleViewPreprocessTaskPayload): string {
    const source = `${payload.baseUrl || ''}::${payload.html}`;
    return `${payload.baseUrl || ''}:${payload.html.length}:${hashCacheKey(source)}`;
  }

  private getCached(payload: ArticleViewPreprocessTaskPayload): ArticleViewPreprocessTaskResult | null {
    const cacheKey = this.buildCacheKey(payload);
    const cached = this.cache.get(cacheKey) || null;
    if (!cached) {
      return null;
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, cached);
    return cached;
  }

  private setCached(payload: ArticleViewPreprocessTaskPayload, result: ArticleViewPreprocessTaskResult): void {
    const cacheKey = this.buildCacheKey(payload);
    const existing = this.cache.get(cacheKey);
    if (existing) {
      this.cacheBytes -= estimateResultBytes(existing);
      this.cache.delete(cacheKey);
    }

    this.cache.set(cacheKey, result);
    this.cacheBytes += estimateResultBytes(result);

    while (this.cache.size > MAX_CACHE_SIZE || this.cacheBytes > MAX_CACHE_BYTES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const oldest = this.cache.get(oldestKey);
        if (oldest) {
          this.cacheBytes -= estimateResultBytes(oldest);
        }
        this.cache.delete(oldestKey);
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  async startPreprocessTask(
    payload: ArticleViewPreprocessTaskPayload,
  ): Promise<RunningArticleContentTask> {
    const cached = this.getCached(payload);
    if (cached) {
      return {
        taskId: 'article-preprocess-cached',
        promise: Promise.resolve(cached),
        cancel: async () => {},
      };
    }

    const taskId = createTaskId();

    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let rejectPromise: ((error: Error) => void) | undefined;

    const cleanup = () => {
      settled = true;
      unsubscribe?.();
      unsubscribe = null;
    };

    const promise = new Promise<ArticleViewPreprocessTaskResult>((resolve, reject) => {
      rejectPromise = reject;
      unsubscribe = helperTaskClient.onTaskResult((event: HelperTaskResultEvent) => {
        if (event.taskId !== taskId) {
          return;
        }

        cleanup();

        if (event.status === 'completed') {
          const result = event.result as ArticleViewPreprocessTaskResult;
          this.setCached(payload, result);
          resolve(result);
          return;
        }

        if (event.status === 'cancelled') {
          reject(createAbortError());
          return;
        }

        reject(new Error(event.error));
      });
    });

    try {
      await helperTaskClient.addTask({
        id: taskId,
        kind: HELPER_TASK_KIND.ARTICLE_VIEW_PREPROCESS,
        priority: 'normal',
        payload,
      });
    } catch (error) {
      cleanup();
      rejectPromise?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return {
      taskId,
      promise,
      cancel: async () => {
        if (settled) {
          return;
        }

        cleanup();
        try {
          await helperTaskClient.removeTask(taskId);
        } finally {
          rejectPromise?.(createAbortError());
        }
      },
    };
  }
}

export const articleContentProcessingService = new ArticleContentProcessingService();
