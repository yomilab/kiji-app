import { useCallback, useRef, useState, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { articleMigration } from '@/services/migration/articleMigration';
import { settingsManager } from '@/services/settings';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import {
  isClearConfigsShortcut,
  isOpenFeedEditViewShortcut,
  isOpenSettingsShortcut,
  isRefreshCurrentFeedShortcut,
  isResetSettingsShortcut,
  isWindowCloseShortcut,
  keybindingService,
} from '@/services/shortcuts/shortcutService';
import { clearAllConfigs } from '@/utils/debugUtils';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import { ARTICLE_VIEW_OPENING_MS } from '@/constants';
import {
  useDependencyEffect,
  useMountEffect,
  useResizeObserverEffect,
  useUnmountEffect,
} from '@/hooks/useLifecycleEffects';
import { logger } from '@/services/logger';
import { appToastService } from '@/services/ui/appToastService';
import { confirmDialog } from '@/services/ui/confirmDialogService';
import { isMainRendererWindow } from '@/utils/rendererWindow';

const BACKGROUND_SCHEDULER_WAKE_LOCK = 'kiji-feed-scheduler-background';

const startBackgroundSchedulerWakeLock = (): (() => void) => {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return () => {};
  }

  const abortController = new AbortController();
  void navigator.locks.request(
    BACKGROUND_SCHEDULER_WAKE_LOCK,
    { mode: 'shared', signal: abortController.signal },
    async () => {
      await new Promise<void>((resolve) => {
        abortController.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  ).catch(() => {
    // Ignore platforms or policies that reject background wake locks.
  });

  return () => abortController.abort();
};

export const useGlobalFetchLogging = (): void => {
  useMountEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const requestInfo = args[0];
      const url = typeof requestInfo === 'string'
        ? requestInfo
        : requestInfo instanceof URL
          ? requestInfo.toString()
          : requestInfo.url;
      console.log('[FETCH] 🌐 Request:', url);

      try {
        const response = await originalFetch(...args);
        console.log('[FETCH] ✓ Response:', url, 'Status:', response.status);
        return response;
      } catch (error) {
        console.error('[FETCH] ✗ Error:', url, (error as Error).message);
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  });
};

export const useStartupMigration = (): void => {
  useMountEffect(() => {
    logger.info('Migration', 'Starting startup article migration check');
    void (async () => {
      try {
        await articleMigration.migrateIfNeeded();
        logger.info('Migration', 'Startup article migration check finished');
      } catch (error) {
        console.error('Migration failed:', error);
        logger.error('Migration', 'Startup article migration failed', { error });
      }
    })();
  });
};

export const useFeedSchedulerLifecycle = (enabled = true): void => {
  useMountEffect(() => {
    if (!enabled || !isMainRendererWindow()) {
      logger.info('Scheduler', 'Skipping feed scheduler lifecycle for non-main window', {
        enabled,
        windowType: new URLSearchParams(window.location.search).get('window') ?? 'main',
      });
      return;
    }

    void feedScheduler.start();
    const releaseBackgroundWakeLock = startBackgroundSchedulerWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        feedScheduler.releaseStationSelectionPause('background');
        return;
      }
      void feedScheduler.catchUpAfterResume();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleSettingsChanged = async () => {
      try {
        const settings = await settingsManager.getSettings();
        await feedScheduler.reconfigure(settings.backgroundUpdate ?? 'every-15m');
        logger.info('Scheduler', 'Reconfigured feed scheduler after settings change', {
          backgroundUpdate: settings.backgroundUpdate ?? 'every-15m',
        });
      } catch (error) {
        console.error('[Scheduler] Failed to reconfigure after settings change:', error);
        logger.error('Scheduler', 'Failed to reconfigure after settings change', { error });
      }
    };

    const removeSettingsChangedListener = window.kijiAPI?.onSettingsChanged?.(handleSettingsChanged);

    return () => {
      releaseBackgroundWakeLock();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (typeof removeSettingsChangedListener === 'function') {
        removeSettingsChangedListener();
      }
      void feedScheduler.stop();
    };
  });
};

interface UseArticleDeckStateInput {
  activeArticleHash: string | null;
  articleOpenTrigger: number;
  isArticleClosing: boolean;
  setArticleViewOverlayPhase: (phase: ArticleViewOverlayPhase) => void;
}

export const useArticleDeckState = ({
  activeArticleHash,
  articleOpenTrigger,
  isArticleClosing,
  setArticleViewOverlayPhase,
}: UseArticleDeckStateInput): boolean => {
  const [isDeckOpen, setIsDeckOpen] = useState(false);
  const prevArticleOpenTriggerRef = useRef(0);
  const openPhaseTimerRef = useRef<number | null>(null);

  useDependencyEffect(() => {
    if (activeArticleHash && articleOpenTrigger > prevArticleOpenTriggerRef.current) {
      setArticleViewOverlayPhase('opening');
      setIsDeckOpen(true);
      prevArticleOpenTriggerRef.current = articleOpenTrigger;

      if (openPhaseTimerRef.current !== null) {
        window.clearTimeout(openPhaseTimerRef.current);
      }

      openPhaseTimerRef.current = window.setTimeout(() => {
        setArticleViewOverlayPhase('open');
        openPhaseTimerRef.current = null;
      }, ARTICLE_VIEW_OPENING_MS);
    }
  }, [activeArticleHash, articleOpenTrigger, setArticleViewOverlayPhase]);

  useDependencyEffect(() => {
    if (!isArticleClosing) return;

    if (openPhaseTimerRef.current !== null) {
      window.clearTimeout(openPhaseTimerRef.current);
      openPhaseTimerRef.current = null;
    }
    setArticleViewOverlayPhase('closing');
    setIsDeckOpen(false);
  }, [isArticleClosing, setArticleViewOverlayPhase]);

  useDependencyEffect(() => {
    if (!isDeckOpen && !isArticleClosing) {
      setArticleViewOverlayPhase('closed');
    }
  }, [isDeckOpen, isArticleClosing, setArticleViewOverlayPhase]);

  useUnmountEffect(() => {
    if (openPhaseTimerRef.current !== null) {
      window.clearTimeout(openPhaseTimerRef.current);
    }
  });

  return isDeckOpen;
};

export const useOpmlWorkflowListener = (): void => {
  useMountEffect(() => {
    opmlWorkflowService.attachFaviconTaskListener();
    return () => {
      opmlWorkflowService.detachFaviconTaskListener();
    };
  });
};

export const useElementWidth = <T extends HTMLElement>(elementRef: RefObject<T>): number => {
  const [width, setWidth] = useState(0);

  const updateWidth = useCallback((element: T) => {
    setWidth(element.getBoundingClientRect().width);
  }, []);

  useResizeObserverEffect(elementRef, updateWidth);

  return width;
};

export const useTimedToast = (visibleMs: number): { message: string | null; showMessage: (message: string) => void } => {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const showMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setMessage(null);
      timerRef.current = null;
    }, visibleMs);
  }, [visibleMs]);

  useUnmountEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  });

  return { message, showMessage };
};

interface UseAppShortcutsInput {
  refreshFeed: () => Promise<void>;
  openFeedEditView: () => void;
  isDeckOpen: boolean;
  requestCloseArticle: () => void;
}

export const useAppShortcuts = ({
  refreshFeed,
  openFeedEditView,
  isDeckOpen,
  requestCloseArticle,
}: UseAppShortcutsInput): void => {
  useDependencyEffect(() => keybindingService.register({
    type: 'keydown',
    capture: true,
    priority: 1000,
    handler: (event: KeyboardEvent) => {
      if (!isWindowCloseShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (isDeckOpen) {
        requestCloseArticle();
        return;
      }

      void getCurrentWindow().close();
    },
  }), [isDeckOpen, requestCloseArticle]);

  useDependencyEffect(() => keybindingService.register({
    type: 'keydown',
    priority: 10,
    handler: (event: KeyboardEvent) => {
      const run = async () => {
        if (isOpenSettingsShortcut(event)) {
          event.preventDefault();
          if (window.kijiAPI) {
            window.kijiAPI.openSettings();
          }
        }

        if (isResetSettingsShortcut(event)) {
          event.preventDefault();
          const confirmed = await confirmDialog({
            title: 'Reset settings',
            message: 'Reset all settings to defaults?\n\nThis will:\n- Reset all fonts to defaults\n- Reset theme preferences\n- Reset layout settings\n- Keep your feeds and articles\n\nThe app will reload after reset.',
          });
          if (confirmed) {
            try {
              await settingsManager.resetSettings();
              window.location.reload();
            } catch (error) {
              console.error('Error resetting settings:', error);
              appToastService.show('Failed to reset settings. Check console for details.');
            }
          }
        }

        if (isClearConfigsShortcut(event)) {
          event.preventDefault();
          const confirmed = await confirmDialog({
            title: 'Clear all data',
            message: 'Clear all user configs and cache?\n\nThis deletes feeds, articles, settings, and local storage. The app will reload.\n\nThis is a debug-only action and cannot be undone.',
          });
          if (confirmed) {
            await clearAllConfigs();
          }
        }

        if (isRefreshCurrentFeedShortcut(event)) {
          if (
            event.target instanceof HTMLInputElement
            || event.target instanceof HTMLTextAreaElement
            || event.target instanceof HTMLSelectElement
            || (event.target instanceof HTMLElement && event.target.isContentEditable)
          ) {
            return;
          }

          event.preventDefault();
          await refreshFeed();
        }

        if (isOpenFeedEditViewShortcut(event)) {
          event.preventDefault();
          if (isDeckOpen) {
            requestCloseArticle();
          }
          openFeedEditView();
        }
      };

      void run();
    },
  }), [refreshFeed, openFeedEditView, isDeckOpen, requestCloseArticle]);
};
