import type { Article } from '@/types/article';

/** Pages of the current list Space may load while looking for an unread article. */
export const NEXT_UNREAD_MAX_LOAD_MORE_PAGES = 5;
/** Frames to wait for a loaded page to reach the list before giving up. */
const LIST_CHANGE_MAX_WAIT_FRAMES = 30;

export const NO_MORE_UNREAD_MESSAGE = 'No more unread articles';
export const NO_MORE_UNREAD_TOAST_MS = 2500;

/**
 * First unread article after `fromHash` in list order. With no `fromHash`
 * (or one no longer in the list) the search starts at the top.
 */
export const findNextUnreadArticleHash = (
  articles: ReadonlyArray<Pick<Article, 'hash' | 'read'>>,
  fromHash: string | null,
): string | null => {
  const fromIndex = fromHash ? articles.findIndex((article) => article.hash === fromHash) : -1;
  for (let index = fromIndex + 1; index < articles.length; index += 1) {
    const article = articles[index];
    if (!article.read && article.hash !== fromHash) {
      return article.hash;
    }
  }
  return null;
};

/** Resolves once `getArticles()` returns a new list, or after a bounded wait. */
export const waitForArticleListChange = (
  getArticles: () => ReadonlyArray<unknown>,
  previous: ReadonlyArray<unknown>,
  maxFrames = LIST_CHANGE_MAX_WAIT_FRAMES,
): Promise<void> => new Promise((resolve) => {
  let frames = 0;
  const check = () => {
    frames += 1;
    if (getArticles() !== previous || frames >= maxFrames) {
      resolve();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
});

export interface ResolveNextUnreadOptions {
  fromHash: string | null;
  getArticles: () => ReadonlyArray<Pick<Article, 'hash' | 'read'>>;
  hasMore: () => boolean;
  loadMore: () => Promise<void>;
  waitForListChange?: (previous: ReadonlyArray<unknown>) => Promise<void>;
  maxLoadMorePages?: number;
}

/**
 * Next unread article in the current list, loading more pages when the
 * loaded rows have none. Null when the list has no unread article left.
 */
export const resolveNextUnreadArticleHash = async ({
  fromHash,
  getArticles,
  hasMore,
  loadMore,
  waitForListChange = (previous) => waitForArticleListChange(getArticles, previous),
  maxLoadMorePages = NEXT_UNREAD_MAX_LOAD_MORE_PAGES,
}: ResolveNextUnreadOptions): Promise<string | null> => {
  for (let page = 0; ; page += 1) {
    const articles = getArticles();
    const nextHash = findNextUnreadArticleHash(articles, fromHash);
    if (nextHash) return nextHash;
    if (page >= maxLoadMorePages || !hasMore()) return null;

    await loadMore();
    await waitForListChange(articles);
    if (getArticles() === articles) return null;
  }
};
