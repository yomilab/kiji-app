import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';

import './styles/base.css';
import './styles/view.css';

import { Sidebar } from './components/Sidebar/Sidebar';
import { MainArea } from './components/MainArea/MainArea';
import { ArticleView } from './components/MainArea/ArticleView';
import { NotificationToast } from './components/common/NotificationToast';
import { useUserMessageChannel } from './hooks/useUserMessageChannel';
import { useSystemAccentColor } from './hooks/useSystemAccentColor';
import {
  useAppShortcuts,
  useArticleDeckState,
  useElementWidth,
  useFeedSchedulerLifecycle,
  useGlobalFetchLogging,
  useOpmlWorkflowListener,
  useStartupMigration,
} from './hooks/useAppEffects';
import { useMountEffect } from './hooks/useLifecycleEffects';
import {
  useFeedNavigation,
  useFeedCollection,
  useFeedOverlay,
  useFeedUI,
  useFeedUIActions,
} from '@/contexts/FeedContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
  formatOpmlImportSummary,
  importOpmlTextIntoLibrary,
} from './services/feeds/opmlUiWorkflow';
import { APP_TOAST_CHANNEL, appToastService } from './services/ui/appToastService';
import { sidebarIndicatorService } from './services/ui/sidebarIndicatorService';
import { useApplicationMenuCommands } from './hooks/useApplicationMenuCommands';
import {
  DECK_SLIDE_EASE,
  APP_LAYER_TRANSITION_MS,
  ARTICLE_LAYER_TRANSITION_MS,
} from './constants';
import { logger } from './services/logger';

const ACCEPTED_XML_MIME_TYPES = new Set([
  'text/xml',
  'application/xml',
  'text/x-opml',
  'application/x-opml',
]);

const hasFilePayload = (dataTransfer: DataTransfer | null): boolean => {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types).includes('Files')) return true;
  return Array.from(dataTransfer.items).some((item) => item.kind === 'file');
};

const isOpmlFile = (file: File): boolean => {
  const loweredName = file.name.toLowerCase();
  return (
    loweredName.endsWith('.opml')
    || loweredName.endsWith('.xml')
    || ACCEPTED_XML_MIME_TYPES.has(file.type.toLowerCase())
  );
};

export const App: React.FC = () => {
  // Initialize system accent color - sets CSS variable
  useSystemAccentColor();
  useGlobalFetchLogging();
  useStartupMigration();
  useFeedSchedulerLifecycle(true);

  useMountEffect(() => {
    logger.info('AppLifecycle', 'App component loaded', {
      search: window.location.search,
    });
  });

  // Otherwise render the main app
  const { theme, setTheme } = useTheme();
  const {
    activeArticleHash,
    articleOpenTrigger,
    isArticleClosing,
    articleViewOverlayPhase,
    setArticleViewOverlayPhase,
    requestCloseArticle,
  } = useFeedOverlay();

  const {
    openFeedEditView,
    selectedSmartView,
    selectSmartView,
    clearFeedSelection,
  } = useFeedNavigation();

  const { refreshFeed, updateArticleInList, reloadCurrentSourceFromStore } = useFeedCollection();

  const {
    refreshTotalFeeds,
  } = useFeedUI();
  const { notifyFeedLibraryChanged } = useFeedUIActions();

  const sidebarLayerRef = useRef<HTMLDivElement>(null);
  const sidebarLayerWidth = useElementWidth(sidebarLayerRef);
  const opmlDragDepthRef = useRef(0);
  const [isOpmlDragActive, setIsOpmlDragActive] = useState(false);
  const appToastMessage = useUserMessageChannel(APP_TOAST_CHANNEL);
  const isDeckOpen = useArticleDeckState({
    activeArticleHash,
    articleOpenTrigger,
    isArticleClosing,
    setArticleViewOverlayPhase,
  });
  useOpmlWorkflowListener();
  useAppShortcuts({
    refreshFeed,
    openFeedEditView,
    isDeckOpen,
    requestCloseArticle,
  });
  useApplicationMenuCommands({
    activeArticleHash,
    requestCloseArticle,
    selectedSmartView,
    selectSmartView,
    clearFeedSelection,
    refreshTotalFeeds,
    notifyFeedLibraryChanged,
    updateArticleInList,
    reloadCurrentSourceFromStore,
    theme,
    setTheme,
  });

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    opmlDragDepthRef.current += 1;
    setIsOpmlDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    opmlDragDepthRef.current = Math.max(0, opmlDragDepthRef.current - 1);
    if (opmlDragDepthRef.current === 0) {
      setIsOpmlDragActive(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    opmlDragDepthRef.current = 0;
    setIsOpmlDragActive(false);

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }

    const opmlFile = files.find(isOpmlFile);
    if (!opmlFile) {
      logger.warn('OPML', 'Dropped file was not a supported OPML/XML file', {
        fileNames: files.map((file) => file.name),
      });
      appToastService.show('Drop an OPML or XML file to import feeds.');
      return;
    }

    try {
      // Surface the expensive parse/import phases in the sidebar indicator so
      // first-run OPML imports do not look stalled.
      sidebarIndicatorService.show('Parse OPML…');
      logger.info('OPML', 'Starting drag-and-drop OPML import', {
        fileName: opmlFile.name,
        fileSize: opmlFile.size,
      });
      const opmlText = await opmlFile.text();
      const importResult = await importOpmlTextIntoLibrary(opmlText, {
        refreshTotalFeeds,
        notifyFeedLibraryChanged,
      });
      appToastService.show(formatOpmlImportSummary(importResult.summary));
      logger.info('OPML', 'Completed drag-and-drop OPML import', {
        summary: importResult.summary,
      });

    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'Failed to import OPML file.';
      sidebarIndicatorService.show('Import failed', { durationMs: 6000 });
      logger.error('OPML', 'OPML drag-and-drop import failed', { error });
      appToastService.show(errorMessage);
    }
  };

  // Parallel card-stack motion:
  // top(article) moves farthest and fastest, bottom(sidebar) shortest and slowest.
  const sidebarTransition = {
    type: 'tween' as const,
    ease: DECK_SLIDE_EASE,
    duration: APP_LAYER_TRANSITION_MS / 1000,
  };

  const mainTransition = {
    type: 'tween' as const,
    ease: DECK_SLIDE_EASE,
    duration: APP_LAYER_TRANSITION_MS / 1000,
  };

  const articleTransition = {
    type: 'tween' as const,
    ease: DECK_SLIDE_EASE,
    duration: ARTICLE_LAYER_TRANSITION_MS / 1000,
  };

  // Shift main content by full sidebar width so it reaches the left boundary in sync.
  const mainOpenShift = -(sidebarLayerWidth > 0 ? sidebarLayerWidth : 300);
  // Start deck slide-out immediately when closing begins instead of waiting for
  // the overlay lifecycle hook to flip isDeckOpen on the next effect pass.
  const isDeckVisuallyOpen = isDeckOpen && !isArticleClosing;

  return (
    // Pointer-event suppression for the library panes is keyed off overlay
    // phase, not a raw closing boolean, so shortcut-driven closes cannot leave
    // the app stuck in a permanently non-interactive state.
    <div className={`app-container ${articleViewOverlayPhase !== 'closed' ? 'article-view-active' : ''}`} data-section="app-root">
      <div
        className={`app-deck-root ${isOpmlDragActive ? 'opml-drop-active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => {
          void handleDrop(event);
        }}
        data-component="app-deck"
      >
        <motion.div
          ref={sidebarLayerRef}
          className="app-layer app-layer-sidebar"
          animate={isDeckVisuallyOpen ? { x: -90 } : { x: 0 }}
          transition={sidebarTransition}
          data-section="sidebar-layer"
        >
          <Sidebar />
        </motion.div>
        <motion.div
          className="app-layer app-layer-main"
          animate={isDeckVisuallyOpen ? { x: mainOpenShift } : { x: 0 }}
          transition={mainTransition}
          data-section="main-layer"
        >
          <MainArea />
        </motion.div>
        <motion.div
          className="app-layer app-layer-article"
          animate={isDeckVisuallyOpen ? { x: 0 } : { x: '100%' }}
          transition={articleTransition}
          data-section="article-layer"
        >
          <ArticleView deckOpen={isDeckOpen} />
        </motion.div>
        {isOpmlDragActive && (
          <div className="opml-drop-overlay" aria-hidden="true" data-component="opml-drop-overlay">
            <span className="opml-drop-overlay-label">Drop OPML file to import feeds</span>
          </div>
        )}
      </div>
      {appToastMessage && (
        <NotificationToast message={appToastMessage} data-component="app-toast" />
      )}
    </div>
  );
};
