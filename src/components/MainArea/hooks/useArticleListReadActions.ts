import { useCallback, useRef } from 'react';
import type { Article } from '@/types/article';
import type { ArticleListUpdatePayload } from '@/contexts/FeedContext';
import { canToggleArticleRead, setArticleReadState } from '@/services/articles/articleReadState';
import { logger } from '@/services/logger';
import { appToastService } from '@/services/ui/appToastService';
import {
  NO_MORE_UNREAD_MESSAGE,
  NO_MORE_UNREAD_TOAST_MS,
  resolveNextUnreadArticleHash,
} from '../articleNextUnread';

interface UseArticleListReadActionsOptions {
  articles: Article[];
  hasMoreArticles: boolean;
  selectedSmartView: string | null;
  updateArticleInList: (hash: string, updates?: ArticleListUpdatePayload) => void;
  loadMoreArticles: (options: { showLoadingIndicator: boolean; priority: 'prefetch' | 'urgent' }) => Promise<void>;
  selectArticle: (hash: string) => void;
}

/**
 * Read-state actions for list rows while no article is open: `m` and the
 * row menu flip read/unread, Space opens the next unread article. Callbacks
 * are stable (they read the latest props through refs).
 */
export const useArticleListReadActions = (options: UseArticleListReadActionsOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const nextUnreadInFlightRef = useRef(false);

  const canToggleRead = useCallback((hash: string): boolean => {
    const { articles, selectedSmartView } = optionsRef.current;
    const article = articles.find((entry) => entry.hash === hash);
    return canToggleArticleRead(article, selectedSmartView);
  }, []);

  const toggleArticleRead = useCallback((hash: string) => {
    const { articles, selectedSmartView } = optionsRef.current;
    const article = articles.find((entry) => entry.hash === hash);
    if (!article || !canToggleArticleRead(article, selectedSmartView)) return;

    const nextRead = !article.read;
    void (async () => {
      try {
        await setArticleReadState(article, nextRead);
        optionsRef.current.updateArticleInList(hash, { read: nextRead });
      } catch (error) {
        logger.warn('ArticleList', 'Failed to change read state', { hash, error });
      }
    })();
  }, []);

  const openNextUnread = useCallback((fromHash: string | null) => {
    if (nextUnreadInFlightRef.current) return;
    nextUnreadInFlightRef.current = true;

    void (async () => {
      try {
        const nextHash = await resolveNextUnreadArticleHash({
          fromHash,
          getArticles: () => optionsRef.current.articles,
          hasMore: () => optionsRef.current.hasMoreArticles,
          loadMore: () => optionsRef.current.loadMoreArticles({ showLoadingIndicator: false, priority: 'urgent' }),
        });
        if (nextHash) {
          optionsRef.current.selectArticle(nextHash);
        } else {
          appToastService.show(NO_MORE_UNREAD_MESSAGE, NO_MORE_UNREAD_TOAST_MS);
        }
      } catch (error) {
        logger.warn('ArticleList', 'Failed to open the next unread article', { error });
      } finally {
        nextUnreadInFlightRef.current = false;
      }
    })();
  }, []);

  return { canToggleRead, toggleArticleRead, openNextUnread };
};
