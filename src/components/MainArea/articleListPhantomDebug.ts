import { logger } from '@/services/logger/logger';

const CATEGORY = 'ArticleListPhantom';

export type ArticleListPhantomDebugPayload = Record<string, unknown>;

/** Temporary investigation logging — always persists to diagnostics log files. */
export function logArticleListPhantomState(payload: ArticleListPhantomDebugPayload): void {
  logger.info(CATEGORY, 'phantom-state', payload);
}

/** Temporary investigation logging — always persists to diagnostics log files. */
export function logArticleListPhantomScroll(payload: ArticleListPhantomDebugPayload): void {
  logger.info(CATEGORY, 'phantom-scroll-near-bottom', payload);
}
