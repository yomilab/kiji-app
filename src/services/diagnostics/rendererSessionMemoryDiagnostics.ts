import type { Article } from '@/types/article';
import { getInternedFeedMetadataCount } from '@/services/articles/articleListMemory';
import {
  logRendererSessionMemoryAttribution,
  type RendererSessionMemoryAttribution,
} from '@/services/diagnostics/webKitAttribution';

const SESSION_MEMORY_SAMPLE_INTERVAL_MS = 60_000;

export function estimateSerializedArticleListKb(articles: Article[]): number {
  if (articles.length === 0) {
    return 0;
  }

  if (articles.length <= 24) {
    return Math.round(JSON.stringify(articles).length / 1024);
  }

  const sampleIndexes = new Set<number>([
    0,
    Math.floor(articles.length / 4),
    Math.floor(articles.length / 2),
    Math.floor((articles.length * 3) / 4),
    articles.length - 1,
  ]);

  let sampleBytes = 0;
  for (const index of sampleIndexes) {
    sampleBytes += JSON.stringify(articles[index]).length;
  }

  const averageRowBytes = sampleBytes / sampleIndexes.size;
  return Math.round((averageRowBytes * articles.length) / 1024);
}

export function startRendererSessionMemoryDiagnostics(
  getSnapshot: () => RendererSessionMemoryAttribution,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const sample = (): void => {
    logRendererSessionMemoryAttribution({
      ...getSnapshot(),
      internFeedCount: getInternedFeedMetadataCount(),
    });
  };

  sample();
  const timerId = window.setInterval(sample, SESSION_MEMORY_SAMPLE_INTERVAL_MS);
  return () => {
    window.clearInterval(timerId);
  };
}
