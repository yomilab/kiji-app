import { useFeedNavigation, useFeedUIActions } from '@/contexts/FeedContext';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { settingsManager } from '@/services/settings';
import { readE2eTextFile } from '@/services/e2e/e2eCommands';
import { waitForE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';
import {
  importOpmlTextIntoLibrary,
  navigateAfterOpmlImport,
} from '@/services/feeds/opmlUiWorkflow';
import { tagsManager } from '@/services/tags/tagsManager';
import { logger } from '@/services/logger';
import * as articleStore from '@/stores/articleStore';

export const useE2eHarness = (): void => {
  const { selectFeed, selectTag } = useFeedNavigation();
  const { refreshTotalFeeds, notifyFeedLibraryChanged } = useFeedUIActions();

  useMountEffect(() => {
    let cycleCount = 0;
    let disposed = false;
    let config: Awaited<ReturnType<typeof waitForE2eConfig>> = null;

    const bootstrapFeed = async (): Promise<void> => {
      if (!config?.feedUrl || disposed) {
        return;
      }

      try {
        await settingsManager.setBackgroundUpdate('every-5m');
        const feed = await feedsManager.addFeed(config.feedUrl, 'E2E Feed', {
          skipMetadataFetch: true,
          skipFaviconRefresh: true,
          id: config.feedId,
        });
        await selectFeed(feed.id, feed.url, feed.title);
        await writeE2eEvent('scheduler-bootstrap', {
          feedId: feed.id,
          feedUrl: feed.url,
        });
      } catch (error) {
        await writeE2eEvent('scheduler-bootstrap-error', {
          message: error instanceof Error ? error.message : String(error),
        });
        logger.error('E2E', 'Scheduler harness bootstrap failed', { error });
      }
    };

    const bootstrapOpml = async (): Promise<void> => {
      if (!config?.opmlPath || disposed) {
        return;
      }

      try {
        await settingsManager.setBackgroundUpdate('every-5m');
        await writeE2eEvent('opml-import-started', { path: config.opmlPath });
        const opmlText = await readE2eTextFile(config.opmlPath);
        const importResult = await importOpmlTextIntoLibrary(opmlText, {
          refreshTotalFeeds,
          notifyFeedLibraryChanged,
          fileName: config.opmlPath.split('/').pop(),
        });
        await navigateAfterOpmlImport(importResult, { selectTag, selectFeed });
        const stations = await tagsManager.getAllTags();
        const feeds = await Promise.all(
          importResult.importedFeeds.map(async ({ id }) => feedsManager.getFeedById(id)),
        );
        await writeE2eEvent('opml-import-complete', {
          feedCount: importResult.importedFeeds.length,
          stationCount: stations.length,
          stationNames: stations.map((station) => station.name),
          feeds: feeds
            .filter((feed): feed is NonNullable<typeof feed> => feed !== null)
            .map((feed) => ({ id: feed.id, title: feed.title, url: feed.url })),
        });
        await writeE2eEvent('scheduler-bootstrap', {
          bootstrap: 'opml',
          feedCount: importResult.importedFeeds.length,
        });
      } catch (error) {
        await writeE2eEvent('scheduler-bootstrap-error', {
          message: error instanceof Error ? error.message : String(error),
        });
        logger.error('E2E', 'OPML harness bootstrap failed', { error });
      }
    };

    const unsubscribe = feedScheduler.on((event) => {
      if (disposed || event.type !== 'cycle-complete' || !config) {
        return;
      }

      cycleCount += 1;
      void (async () => {
        const allFeeds = await feedsManager.getAllFeeds();
        let articleCount = 0;
        for (const feed of allFeeds) {
          articleCount += await articleStore.getArticleCount(feed.id);
        }
        await writeE2eEvent('cycle-complete', {
          cycleCount,
          articleCount,
        });
        if (cycleCount === 1 && articleCount > 0) {
          await writeE2eEvent('scheduler-ready', { cycleCount, articleCount });
        }
      })();
    });

    void (async () => {
      config = await waitForE2eConfig();
      if (!config || disposed) {
        return;
      }

      await writeE2eEvent('scheduler-harness-mounted', {
        feedId: config.feedId,
        schedulerIntervalMs: config.schedulerIntervalMs,
        bootstrap: config.bootstrap,
      });

      const bootstrapMode = config.bootstrap ?? 'feed';
      if (bootstrapMode === 'opml') {
        await bootstrapOpml();
      } else if (bootstrapMode === 'feed') {
        await bootstrapFeed();
      }

      void feedScheduler.catchUpAfterResume();
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  });
};
