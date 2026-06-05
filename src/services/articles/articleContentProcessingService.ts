export interface ArticleViewPreprocessTaskPayload {
  html: string;
  baseUrl?: string;
}

export interface ArticleViewPreprocessTaskResult {
  html: string;
  baseUrl?: string;
  hasEmbeddableMedia?: boolean;
}

interface RunningArticleContentTask {
  taskId: string;
  promise: Promise<ArticleViewPreprocessTaskResult>;
  cancel: () => Promise<void>;
}

class ArticleContentProcessingService {
  private cache = new Map<string, ArticleViewPreprocessTaskResult>();

  clearCache(): void {
    this.cache.clear();
  }

  async startPreprocessTask(
    payload: ArticleViewPreprocessTaskPayload,
  ): Promise<RunningArticleContentTask> {
    const cacheKey = `${payload.baseUrl ?? ''}:${payload.html.length}:${payload.html.slice(0, 128)}`;
    const cached = this.cache.get(cacheKey);
    const result = cached ?? {
      html: payload.html,
      baseUrl: payload.baseUrl,
      hasEmbeddableMedia: /<(iframe|video|audio|lite-youtube)\b/i.test(payload.html),
    };

    if (!cached) {
      this.cache.set(cacheKey, result);
    }

    return {
      taskId: cached ? 'article-preprocess-cached' : `article-preprocess-${Date.now()}`,
      promise: Promise.resolve(result),
      cancel: async () => {},
    };
  }
}

export const articleContentProcessingService = new ArticleContentProcessingService();
