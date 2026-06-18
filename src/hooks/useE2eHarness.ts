import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { settingsManager } from '@/services/settings';
import { waitForE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';
import { logger } from '@/services/logger';
import * as articleStore from '@/stores/articleStore';

export const useE2eHarness = (): void => {
  useMountEffect(() => {
    let cycleCount = 0;
    let disposed = false;
    let config: Awaited<ReturnType<typeof waitForE2eConfig>> = null;

    const bootstrap = async (): Promise<void> => {
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

    const unsubscribe = feedScheduler.on((event) => {
      if (disposed || event.type !== 'cycle-complete' || !config) {
        return;
      }

      cycleCount += 1;
      void (async () => {
        const articleCount = await articleStore.getArticleCount(config.feedId);
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
      });
      await bootstrap();
      void feedScheduler.catchUpAfterResume();
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  });
};
