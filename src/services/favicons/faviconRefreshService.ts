import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { feedsManager } from '@/services/feeds/feedsManager';
import { logger } from '@/services/logger';
import { FAVICON_REFRESH_COOLDOWN_MS } from '@/constants';

/**
 * Fire-and-forget favicon refresh that piggybacks on article fetching.
 * If the favicon hasn't been refreshed in over 24 hours, re-fetches it.
 */
export async function maybeRefreshFavicon(
  feedId: string,
  feedUrl: string,
  onChanged?: () => void,
): Promise<void> {
  try {
    const feed = await feedsManager.getFeedById(feedId);
    if (!feed) return;

    // Skip feeds with custom emoji — user has overridden the icon
    if (feed.emoji) return;

    // Check staleness
    if (
      feed.lastFaviconRefresh &&
      Date.now() - feed.lastFaviconRefresh.getTime() < FAVICON_REFRESH_COOLDOWN_MS
    ) {
      return;
    }

    const newFavicon = await faviconFetcher.fetchFavicon(feedUrl);

    if (newFavicon && newFavicon !== feed.favicon) {
      const updatedFeed = await feedsManager.applyFaviconResult(feedId, newFavicon);
      logger.info('faviconRefresh', 'Favicon updated', { feedId });
      if (updatedFeed) {
        onChanged?.();
      }
      return;
    }

    await feedsManager.updateFeed(feedId, {
      lastFaviconRefresh: new Date(),
    });
  } catch (error) {
    logger.warn('faviconRefresh', 'Favicon refresh failed', {
      feedId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
