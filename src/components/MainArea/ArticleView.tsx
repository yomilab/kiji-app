import React, { useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArchiveIcon from '@mui/icons-material/Archive';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArticleIcon from '@mui/icons-material/Article';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import { motion, AnimatePresence } from 'motion/react';
import { useFeedNavigation, useFeedCollection, useFeedOverlay, type ArticleListUpdatePayload } from '@/contexts/FeedContext';
import * as articleStore from '@/stores/articleStore';
import { articlesManager } from '@/services/articles/articlesManager';
import { articleContentProcessingService } from '@/services/articles/articleContentProcessingService';
import { sanitizeArticleHtmlStyles } from '@/services/articles/articleStyleSanitizer';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import { feedsManager } from '@/services/feeds/feedsManager';
import { logger } from '@/services/logger';
import { appToastService } from '@/services/ui/appToastService';
import { readerModeService, type ReaderModeContent } from '@/services/articles/readerModeService';
import { postlightParserService } from '@/services/articles/postlightParserService';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { extractUrlFromText } from '@/utils/urlValidator';
import { hasEmbeddableMedia, selectArticleHtmlContent } from '@/utils/articleContentSelection';
import { createTemporaryArticleFromPostlight } from '@/utils/temporaryArticleFactory';
import { buildYouTubeEmbedHtml, resolveYouTubeWatchUrl } from '@/utils/youtubeEmbed';
import { injectLeadImage } from '@/utils/articleLeadImage';
import {
  getLinkOnlySavedContent,
  shouldSaveLinkOnlyContent,
} from '@/utils/articleContentSave';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';
import { renderTextWithNonAsciiFont } from '@/utils/nonAsciiTypography';
import { StatefulButtonGroup, type ButtonState } from '@/components/common/StatefulButtonGroup';
import { ArticleContent, ArticleContentSkeleton } from '@/components/common/ArticleContent';
import { ArticlePdfViewer } from '@/components/common/ArticlePdf';
import { InteractionProfiler } from '@/components/common/InteractionProfiler';
import { TOOLTIPS } from '@/config/tooltips';
import {
  isCloseArticleViewShortcut,
  isCopyArticleUrlShortcut,
  isOpenInBrowserShortcut,
  isOpenInNewWindowShortcut,
  isToggleReaderModeShortcut,
  isSaveArticleShortcut,
  isLoadFromClipboardShortcut,
  isVimScrollBottomShortcut,
  isVimScrollHalfDownShortcut,
  isVimScrollHalfUpShortcut,
  isVimScrollTopKey,
  SHORTCUT_HINTS,
  SHORTCUT_LABELS,
  keybindingService,
  withShortcutHint,
} from '@/services/shortcuts/shortcutService';
import { ARTICLE_VIEW_CLOSE_ANIMATION_MS, ARTICLE_VIEW_OPENING_MS } from '@/constants';
import type { Article } from '@/types/article';
import { animateElementScrollTop, getScrollableBottom } from '@/utils/fixedTimeScroll';
import { useDependencyEffect, useUnmountEffect } from '@/hooks/useLifecycleEffects';
import { useArticleViewPerformanceMetrics } from './hooks/useArticleViewPerformanceMetrics';
import './ArticleView.css';

interface ArticleViewProps {
  // Optional: Pass article directly for standalone window mode
  article?: Article;
  // Optional: Standalone mode (no back button, different layout)
  standalone?: boolean;
  // Optional: coordinated deck animation state from App
  deckOpen?: boolean;
}

type ArticleDisplayMode = 'basic' | 'reader';
type ArticleEnclosure = NonNullable<Article['enclosures']>[number];

const STANDALONE_CONTENT_GUARD_THRESHOLD = 400000;
const ARTICLE_VIEW_TITLE_PRESS_FEEDBACK_MS = 140;
const ARTICLE_VIEW_ELEMENT_TRANSITION = {
  type: 'tween' as const,
  ease: [0.22, 0.61, 0.36, 1] as const,
  duration: 0.18,
};
const AUDIO_EXTENSION_PATTERN = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;

// Simple cache to avoid flash of content for known feeds
const FEED_READER_MODE_CACHE_MAX_ENTRIES = 256;
const feedReaderModeCache = new Map<string, boolean>();

const rememberFeedReaderMode = (feedId: string, enabled: boolean): void => {
  feedReaderModeCache.delete(feedId);
  feedReaderModeCache.set(feedId, enabled);
  while (feedReaderModeCache.size > FEED_READER_MODE_CACHE_MAX_ENTRIES) {
    const oldestKey = feedReaderModeCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    feedReaderModeCache.delete(oldestKey);
  }
};

function getBasicModeContentForSave(article: Article): string {
  const articleContent = article.content || '';
  const baseContent = articleContent.trim() ? articleContent : (article.description || '');
  return injectLeadImage(baseContent, article.previewImage);
}

function isSaveableHtmlContent(content?: string | null): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  const textOnly = trimmed.replace(/<[^>]*>/g, '').trim();
  return textOnly.length > 0 || hasEmbeddableMedia(trimmed);
}

function shouldUseSavedArticleSnapshot(
  _article: Article | null | undefined,
  selectedSmartView: string | null,
): boolean {
  // Saved snapshot mode applies only in the Saved smart view. A feed-linked
  // article that happens to be saved must still follow reader/basic toggles.
  return selectedSmartView === 'saved';
}

function isAudioEnclosure(articleEnclosure: ArticleEnclosure): boolean {
  return articleEnclosure.type.toLowerCase().startsWith('audio/')
    || AUDIO_EXTENSION_PATTERN.test(articleEnclosure.url);
}

function selectPrimaryAudioEnclosure(article: Article | null): ArticleEnclosure | undefined {
  return article?.enclosures?.find(isAudioEnclosure);
}

function hasInlineAudioMarkup(html: string): boolean {
  return /<(audio|feed-audio-player)\b/i.test(html);
}

function ArticlePodcastAudio({
  article,
  enclosure,
}: {
  article: Article;
  enclosure: ArticleEnclosure;
}) {
  return (
    <section className="article-view-audio" data-component="podcast-audio">
      <div className="article-view-audio-label">
        Episode audio
      </div>
      <feed-audio-player
        src={enclosure.url}
        title={article.title || enclosure.url}
        data-component="podcast-audio-player"
      />
    </section>
  );
}

function useTransientPressedState(resetKey: string | undefined): {
  isPressed: boolean;
  trigger: () => void;
} {
  const [isPressed, setIsPressed] = useState(false);
  const clearTimerRef = useRef<number | null>(null);

  const trigger = useCallback(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }

    setIsPressed(true);
    clearTimerRef.current = window.setTimeout(() => {
      setIsPressed(false);
      clearTimerRef.current = null;
    }, ARTICLE_VIEW_TITLE_PRESS_FEEDBACK_MS);
  }, []);

  useDependencyEffect(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setIsPressed(false);
  }, [resetKey]);

  useUnmountEffect(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
  });

  return { isPressed, trigger };
}

// Phase 0: keep current article identity synchronized for stale-async guards.
function useCurrentArticleTracking(
  articleHash: string | undefined,
  currentArticleHashRef: React.MutableRefObject<string | null>
): void {
  useDependencyEffect(() => {
    currentArticleHashRef.current = articleHash || null;
  }, [articleHash]);
}

// Phase 1: bootstrap standalone article windows from the incoming prop article.
function useStandaloneArticleBootstrap(params: {
  standalone: boolean;
  propArticle: Article | undefined;
  isTemporaryArticle: boolean;
  modeRequestVersionRef: React.MutableRefObject<number>;
  currentArticleHashRef: React.MutableRefObject<string | null>;
  standaloneSyncedHashRef: React.MutableRefObject<string | null>;
  setIsSaved: React.Dispatch<React.SetStateAction<boolean>>;
  getInitialSavedState: (article: Article | null | undefined) => boolean;
  setArticleToShow: React.Dispatch<React.SetStateAction<Article | null>>;
  configureReaderModeForArticle: (article: Article, isFeedLinked: boolean) => Promise<void>;
  syncSavedState: (article: Article) => Promise<void>;
  updateLastReadTime: (article: Article) => Promise<void>;
  markArticleAsReadOnOpen: (article: Article, isFeedLinked: boolean) => Promise<void>;
}): void {
  const {
    standalone,
    propArticle,
    isTemporaryArticle,
    modeRequestVersionRef,
    currentArticleHashRef,
    standaloneSyncedHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    configureReaderModeForArticle,
    syncSavedState,
    updateLastReadTime,
    markArticleAsReadOnOpen,
  } = params;

  useDependencyEffect(() => {
    if (!standalone || !propArticle || isTemporaryArticle) return;

    const incomingHash = propArticle.hash;
    if (standaloneSyncedHashRef.current === incomingHash) return;

    standaloneSyncedHashRef.current = incomingHash;
    modeRequestVersionRef.current += 1;
    currentArticleHashRef.current = incomingHash;
    setIsSaved(getInitialSavedState(propArticle));
    setArticleToShow(propArticle);
    const selectedIsFeedLinked = propArticle.isFeedLinked ?? (propArticle.feedId !== 'clipboard' && propArticle.feedId !== 'saved');
    void configureReaderModeForArticle(propArticle, selectedIsFeedLinked);
    void syncSavedState(propArticle);
    void updateLastReadTime(propArticle);
    void markArticleAsReadOnOpen(propArticle, selectedIsFeedLinked);
  }, [
    standalone,
    propArticle,
    isTemporaryArticle,
    modeRequestVersionRef,
    currentArticleHashRef,
    standaloneSyncedHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    configureReaderModeForArticle,
    syncSavedState,
    updateLastReadTime,
    markArticleAsReadOnOpen,
  ]);
}

// Phase 1: bootstrap embedded article state as soon as a new article is opened.
function useEmbeddedArticleOpenBootstrap(params: {
  standalone: boolean;
  selectedSmartView: string | null;
  selectedArticle: Article | undefined;
  articleOpenTrigger: number;
  lastOpenTriggerRef: React.MutableRefObject<number>;
  timeoutRef: React.MutableRefObject<number | null>;
  flushPendingArticleListUpdate: () => void;
  setIsClosing: React.Dispatch<React.SetStateAction<boolean>>;
  currentArticleHashRef: React.MutableRefObject<string | null>;
  setIsSaved: React.Dispatch<React.SetStateAction<boolean>>;
  getInitialSavedState: (article: Article | null | undefined) => boolean;
  setArticleToShow: React.Dispatch<React.SetStateAction<Article | null>>;
  clearCurrentReaderContent: () => void;
  setReaderContent: React.Dispatch<React.SetStateAction<ReaderModeContent | null>>;
  setReaderError: React.Dispatch<React.SetStateAction<string | null>>;
  setReaderLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setArticleResourceType: React.Dispatch<React.SetStateAction<'html' | 'pdf' | 'unsupported' | null>>;
  modeRequestVersionRef: React.MutableRefObject<number>;
  cancelArticleBodyProcessing: () => void;
  setProcessedArticleBodyHtml: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessedArticleBodyKey: React.Dispatch<React.SetStateAction<string | null>>;
  setArticleBodyProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setArticleDisplayMode: React.Dispatch<React.SetStateAction<ArticleDisplayMode>>;
  ensureReaderContentForArticle: (article: Article, requestVersion: number) => void;
  setIsTemporaryArticle: React.Dispatch<React.SetStateAction<boolean>>;
  setClipboardError: React.Dispatch<React.SetStateAction<string | null>>;
  markArticleAsReadOnOpen: (article: Article, isFeedLinked: boolean) => Promise<void>;
}): void {
  const {
    standalone,
    selectedSmartView,
    selectedArticle,
    articleOpenTrigger,
    lastOpenTriggerRef,
    timeoutRef,
    flushPendingArticleListUpdate,
    setIsClosing,
    currentArticleHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    clearCurrentReaderContent,
    setReaderContent,
    setReaderError,
    setReaderLoading,
    setArticleResourceType,
    modeRequestVersionRef,
    cancelArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    setArticleBodyProcessing,
    setArticleDisplayMode,
    ensureReaderContentForArticle,
    setIsTemporaryArticle,
    setClipboardError,
    markArticleAsReadOnOpen,
  } = params;

  useDependencyEffect(() => {
    if (standalone || !selectedArticle) return;
    if (articleOpenTrigger <= lastOpenTriggerRef.current) return;

    lastOpenTriggerRef.current = articleOpenTrigger;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    flushPendingArticleListUpdate();
    setIsClosing(false);
    currentArticleHashRef.current = selectedArticle.hash;
    setIsSaved(getInitialSavedState(selectedArticle));
    
    // Ensure we have the full content if it's missing from the list item
    const bootstrapArticle = async () => {
      let fullArticle = selectedArticle;
      try {
        if (selectedSmartView === 'saved' && selectedArticle.savedArticleId) {
          const savedContent = await articleStore.getSavedContent(selectedArticle.savedArticleId);
          if (savedContent && currentArticleHashRef.current === selectedArticle.hash) {
            fullArticle = { ...fullArticle, content: savedContent };
          }
        } else if (!selectedArticle.content || selectedArticle.content.trim() === '') {
          const content = await articleStore.getContent(selectedArticle.hash);
          if (content && currentArticleHashRef.current === selectedArticle.hash) {
            fullArticle = { ...selectedArticle, content };
          }
        }
      } catch (error) {
        console.error('Failed to fetch full article content:', error);
      }
      
      if (currentArticleHashRef.current === selectedArticle.hash) {
        setArticleToShow(fullArticle);
        
        // After we have the full content, run the rest of the bootstrap logic
        const selectedIsFeedLinked = fullArticle.isFeedLinked ?? (fullArticle.feedId !== 'clipboard' && fullArticle.feedId !== 'saved');
        if (shouldUseSavedArticleSnapshot(fullArticle, selectedSmartView)) {
          setArticleDisplayMode('basic');
          setReaderLoading(false);
        } else if (selectedIsFeedLinked) {
          const openRequestVersion = modeRequestVersionRef.current;
          const cachedMode = feedReaderModeCache.get(fullArticle.feedId);
          if (cachedMode !== undefined) {
            setArticleDisplayMode(cachedMode ? 'reader' : 'basic');
            if (cachedMode) {
              setReaderLoading(true);
              if (fullArticle.link) {
                ensureReaderContentForArticle(fullArticle, openRequestVersion);
              }
            } else {
              setReaderLoading(false);
            }
          } else {
            setArticleDisplayMode('basic');
            setReaderLoading(false);
          }

          void feedsManager.getFeedById(fullArticle.feedId).then((feed) => {
            if (articleOpenTrigger === lastOpenTriggerRef.current && openRequestVersion === modeRequestVersionRef.current) {
              const mode = !!feed?.readerModeEnabled;
              rememberFeedReaderMode(fullArticle.feedId, mode);
              setArticleDisplayMode(mode ? 'reader' : 'basic');
              if (mode && fullArticle.link) {
                ensureReaderContentForArticle(fullArticle, openRequestVersion);
              }
              if (!mode) {
                setReaderLoading(false);
              }
            }
          });
        } else {
          setArticleDisplayMode('basic');
          setReaderLoading(false);
        }

        setIsTemporaryArticle(false);
        setClipboardError(null);
        void markArticleAsReadOnOpen(fullArticle, selectedIsFeedLinked);
      }
    };
    
    void bootstrapArticle();

    clearCurrentReaderContent();
    setReaderContent(null);
    setReaderError(null);
    setReaderLoading(false);
    setArticleResourceType(null);
    modeRequestVersionRef.current += 1;
    cancelArticleBodyProcessing();
    articleContentProcessingService.clearCache();
    setProcessedArticleBodyHtml(null);
    setProcessedArticleBodyKey(null);
    setArticleBodyProcessing(false);

    if (window.electronAPI) {
      window.electronAPI.hideTrafficLights();
    }
  }, [
    standalone,
    selectedSmartView,
    selectedArticle,
    articleOpenTrigger,
    lastOpenTriggerRef,
    timeoutRef,
    flushPendingArticleListUpdate,
    setIsClosing,
    currentArticleHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    setReaderContent,
    setReaderError,
    setReaderLoading,
    setArticleResourceType,
    modeRequestVersionRef,
    cancelArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    setArticleBodyProcessing,
    setArticleDisplayMode,
    ensureReaderContentForArticle,
    setIsTemporaryArticle,
    setClipboardError,
    markArticleAsReadOnOpen,
  ]);
}

function useEmbeddedArticleCloseFlow(params: {
  standalone: boolean;
  articleCloseRequest: number;
  articleToShow: Article | null;
  isClosing: boolean;
  lastCloseRequestRef: React.MutableRefObject<number>;
  timeoutRef: React.MutableRefObject<number | null>;
  cancelArticleBodyProcessing: () => void;
  setArticleBodyProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsClosing: React.Dispatch<React.SetStateAction<boolean>>;
  flushPendingArticleListUpdate: () => void;
  setArticleToShow: React.Dispatch<React.SetStateAction<Article | null>>;
  setProcessedArticleBodyHtml: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessedArticleBodyKey: React.Dispatch<React.SetStateAction<string | null>>;
  setArticleResourceType: React.Dispatch<React.SetStateAction<'html' | 'pdf' | 'unsupported' | null>>;
  completeArticleClose: () => void;
}): void {
  const {
    standalone,
    articleCloseRequest,
    articleToShow,
    isClosing,
    lastCloseRequestRef,
    timeoutRef,
    cancelArticleBodyProcessing,
    setArticleBodyProcessing,
    setIsClosing,
    flushPendingArticleListUpdate,
    setArticleToShow,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    setArticleResourceType,
    completeArticleClose,
  } = params;

  useDependencyEffect(() => {
    if (standalone) return;
    if (articleCloseRequest <= lastCloseRequestRef.current) return;

    lastCloseRequestRef.current = articleCloseRequest;

    // Shared callers such as Cmd+E and the article back button both funnel
    // through this close request path so the exit animation and teardown logic
    // cannot drift apart.
    if (!articleToShow || isClosing) {
      completeArticleClose();
      return;
    }

    cancelArticleBodyProcessing();
    setArticleBodyProcessing(false);
    setIsClosing(true);

    timeoutRef.current = window.setTimeout(() => {
      flushPendingArticleListUpdate();
      setIsClosing(false);
      setArticleToShow(null);
      setArticleResourceType(null);
      articleContentProcessingService.clearCache();
      setProcessedArticleBodyHtml(null);
      setProcessedArticleBodyKey(null);
      setArticleBodyProcessing(false);
      if (window.electronAPI) {
        window.electronAPI.showTrafficLights();
      }
      completeArticleClose();
    }, ARTICLE_VIEW_CLOSE_ANIMATION_MS);
  }, [
    standalone,
    articleCloseRequest,
    articleToShow,
    isClosing,
    lastCloseRequestRef,
    timeoutRef,
    cancelArticleBodyProcessing,
    setArticleBodyProcessing,
    setIsClosing,
    flushPendingArticleListUpdate,
    setArticleToShow,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    completeArticleClose,
  ]);
}

// Phase 2: run heavier article synchronization after the overlay has fully opened.
function useEmbeddedArticlePostOpenSync(params: {
  standalone: boolean;
  selectedArticle: Article | undefined;
  articleOpenTrigger: number;
  articleViewOverlayPhase: string;
  lastProcessedTriggerRef: React.MutableRefObject<number>;
  syncSavedState: (article: Article) => Promise<void>;
  configureReaderModeForArticle: (article: Article, isFeedLinked: boolean) => Promise<void>;
  updateLastReadTime: (article: Article) => Promise<void>;
}): void {
  const {
    standalone,
    selectedArticle,
    articleOpenTrigger,
    articleViewOverlayPhase,
    lastProcessedTriggerRef,
    syncSavedState,
    configureReaderModeForArticle,
    updateLastReadTime,
  } = params;

  useDependencyEffect(() => {
    if (standalone || !selectedArticle || articleViewOverlayPhase !== 'open') return;
    if (articleOpenTrigger <= lastProcessedTriggerRef.current) return;

    lastProcessedTriggerRef.current = articleOpenTrigger;
    const selectedIsFeedLinked = selectedArticle.isFeedLinked ?? (selectedArticle.feedId !== 'clipboard' && selectedArticle.feedId !== 'saved');
    void syncSavedState(selectedArticle);
    void configureReaderModeForArticle(selectedArticle, selectedIsFeedLinked);
    void updateLastReadTime(selectedArticle);
  }, [
    standalone,
    selectedArticle,
    articleOpenTrigger,
    articleViewOverlayPhase,
    lastProcessedTriggerRef,
    syncSavedState,
    configureReaderModeForArticle,
    updateLastReadTime,
  ]);
}

// Phase 3: register article-view keyboard behavior.
function useArticleViewKeyboardShortcuts(params: {
  standalone: boolean;
  articleToShow: Article | null;
  isFeedLinkedArticle: boolean;
  isClosing: boolean;
  handleBack: () => void;
  articleDisplayMode: ArticleDisplayMode;
  handleReaderModeToggle: (nextStateIndex: number) => Promise<void>;
  clipboardLoading: boolean;
  saveLoading: boolean;
  canToggleReaderMode: boolean;
  handleSaveArticle: () => Promise<void>;
  handleClipboardLoad: () => Promise<void>;
  handleCopyArticleUrl: () => Promise<void>;
  handleOpenInBrowser: (withPressedFeedback?: boolean) => void;
  handleOpenInNewWindow: () => Promise<void>;
  scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}): void {
  const {
    standalone,
    articleToShow,
    isFeedLinkedArticle,
    isClosing,
    handleBack,
    articleDisplayMode,
    handleReaderModeToggle,
    clipboardLoading,
    saveLoading,
    canToggleReaderMode,
    handleSaveArticle,
    handleClipboardLoad,
    handleCopyArticleUrl,
    handleOpenInBrowser,
    handleOpenInNewWindow,
    scrollContainerRef,
  } = params;

  useDependencyEffect(() => {
    const VIM_SEQUENCE_TIMEOUT_MS = 700;
    let pendingTopSequenceTimerId: number | null = null;
    let cancelScrollAnimation: (() => void) | null = null;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const clearPendingTopSequence = () => {
      if (pendingTopSequenceTimerId !== null) {
        window.clearTimeout(pendingTopSequenceTimerId);
        pendingTopSequenceTimerId = null;
      }
    };

    const cancelActiveScrollAnimation = () => {
      if (cancelScrollAnimation) {
        cancelScrollAnimation();
        cancelScrollAnimation = null;
      }
    };

    const animateArticleTo = (top: number) => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      cancelActiveScrollAnimation();
      cancelScrollAnimation = animateElementScrollTop(scrollElement, top);
    };

    const animateArticleBy = (delta: number) => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      animateArticleTo(scrollElement.scrollTop + delta);
    };

    const unregister = keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 200,
      handler: (e: KeyboardEvent) => {
        const handleVimScrollShortcut = (): boolean => {
          const scrollElement = scrollContainerRef.current;
          if (!scrollElement || isEditableTarget(e.target)) return false;

          if (isVimScrollTopKey(e)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (pendingTopSequenceTimerId !== null) {
              clearPendingTopSequence();
              animateArticleTo(0);
              return true;
            }

            pendingTopSequenceTimerId = window.setTimeout(() => {
              pendingTopSequenceTimerId = null;
            }, VIM_SEQUENCE_TIMEOUT_MS);
            return true;
          }

          clearPendingTopSequence();

          if (isVimScrollBottomShortcut(e)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            animateArticleTo(getScrollableBottom(scrollElement));
            return true;
          }

          if (isVimScrollHalfDownShortcut(e)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            animateArticleBy(scrollElement.clientHeight / 2);
            return true;
          }

          if (isVimScrollHalfUpShortcut(e)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            animateArticleBy(-scrollElement.clientHeight / 2);
            return true;
          }

          return false;
        };

        if (handleVimScrollShortcut()) return;

        if (!standalone) {
          if (isCloseArticleViewShortcut(e) && articleToShow && !isClosing) {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleBack();
          }
        }

        if (isOpenInBrowserShortcut(e) && articleToShow?.link) {
          e.preventDefault();
          handleOpenInBrowser(true);
        }

        if (isCopyArticleUrlShortcut(e) && articleToShow?.link) {
          e.preventDefault();
          void handleCopyArticleUrl();
        }

        if (isOpenInNewWindowShortcut(e) && !standalone && articleToShow) {
          e.preventDefault();
          void handleOpenInNewWindow();
        }

        if (canToggleReaderMode && isToggleReaderModeShortcut(e) && articleToShow?.link && isFeedLinkedArticle) {
          e.preventDefault();
          const nextStateIndex = articleDisplayMode === 'reader' ? 0 : 1;
          void handleReaderModeToggle(nextStateIndex);
        }

        if (isSaveArticleShortcut(e) && articleToShow && !clipboardLoading && !saveLoading) {
          e.preventDefault();
          void handleSaveArticle();
        }

        if (isLoadFromClipboardShortcut(e) && standalone && !clipboardLoading) {
          e.preventDefault();
          void handleClipboardLoad();
        }
      },
    });

    return () => {
      unregister();
      if (pendingTopSequenceTimerId !== null) {
        window.clearTimeout(pendingTopSequenceTimerId);
      }
      cancelActiveScrollAnimation();
    };
  }, [
    standalone,
    articleToShow,
    isFeedLinkedArticle,
    isClosing,
    handleBack,
    articleDisplayMode,
    handleReaderModeToggle,
    clipboardLoading,
    saveLoading,
    canToggleReaderMode,
    handleSaveArticle,
    handleClipboardLoad,
    handleCopyArticleUrl,
    handleOpenInBrowser,
    handleOpenInNewWindow,
    scrollContainerRef,
  ]);
}

// Phase 3: derive header scroll styling from the current article container.
function useArticleScrollState(params: {
  articleHash: string | undefined;
  clipboardLoading: boolean;
  scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  setHasScrollOffset: React.Dispatch<React.SetStateAction<boolean>>;
}): void {
  const { articleHash, clipboardLoading, scrollContainerRef, setHasScrollOffset } = params;

  useDependencyEffect(() => {
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    setHasScrollOffset(scrollTop > 0);
  }, [articleHash, clipboardLoading, scrollContainerRef, setHasScrollOffset]);
}

// Phase 4: preprocess the active article body without blocking first render.
function useArticleBodyPreprocessing(params: {
  activeArticleBodyKey: string | null;
  articleBodyBaseUrl: string | undefined;
  articleResourceType: 'html' | 'pdf' | 'unsupported' | null;
  articleViewOverlayPhase: string;
  articleToShow: Article | null;
  cancelArticleBodyProcessing: () => void;
  clipboardError: string | null;
  clipboardLoading: boolean;
  isClosing: boolean;
  isContentTooLargeForStandalone: boolean;
  standalone: boolean;
  processedArticleBodyHtml: string | null;
  processedArticleBodyKey: string | null;
  rawArticleBodyHtml: string;
  readerError: string | null;
  readerLoading: boolean;
  currentBodyTaskIdRef: React.MutableRefObject<number>;
  currentBodyTaskCancelRef: React.MutableRefObject<null | (() => Promise<void>)>;
  setArticleBodyProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setProcessedArticleBodyHtml: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessedArticleBodyKey: React.Dispatch<React.SetStateAction<string | null>>;
}): void {
  const {
    activeArticleBodyKey,
    articleBodyBaseUrl,
    articleResourceType,
    articleViewOverlayPhase,
    articleToShow,
    cancelArticleBodyProcessing,
    clipboardError,
    clipboardLoading,
    isClosing,
    isContentTooLargeForStandalone,
    standalone,
    processedArticleBodyHtml,
    processedArticleBodyKey,
    rawArticleBodyHtml,
    readerError,
    readerLoading,
    currentBodyTaskIdRef,
    currentBodyTaskCancelRef,
    setArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
  } = params;

  useDependencyEffect(() => {
    const canStartBodyPreprocessing = standalone || articleViewOverlayPhase === 'open';
    const shouldPreprocessBody = !!articleToShow
      && !isClosing
      && canStartBodyPreprocessing
      && !clipboardLoading
      && !readerLoading
      && !readerError
      && !clipboardError
      && articleResourceType === null
      && !isContentTooLargeForStandalone
      && !!activeArticleBodyKey;

    if (!shouldPreprocessBody || !activeArticleBodyKey) {
      cancelArticleBodyProcessing();
      setArticleBodyProcessing(false);
      return;
    }

    if (!rawArticleBodyHtml.trim()) {
      cancelArticleBodyProcessing();
      setProcessedArticleBodyHtml(rawArticleBodyHtml);
      setProcessedArticleBodyKey(activeArticleBodyKey);
      setArticleBodyProcessing(false);
      return;
    }

    if (processedArticleBodyKey === activeArticleBodyKey && processedArticleBodyHtml !== null) {
      setArticleBodyProcessing(false);
      return;
    }

    cancelArticleBodyProcessing();
    setArticleBodyProcessing(true);
    setProcessedArticleBodyHtml(null);
    setProcessedArticleBodyKey(null);

    const taskId = currentBodyTaskIdRef.current + 1;
    currentBodyTaskIdRef.current = taskId;
    let isDisposed = false;

    void articleContentProcessingService.startPreprocessTask({
      html: rawArticleBodyHtml,
      baseUrl: articleBodyBaseUrl,
    }).then((task) => {
      if (isDisposed || currentBodyTaskIdRef.current !== taskId || isClosing) {
        void task.promise.catch(() => {});
        void task.cancel();
        return;
      }

      currentBodyTaskCancelRef.current = task.cancel;

      return task.promise
        .then((result) => {
          if (isDisposed || currentBodyTaskIdRef.current !== taskId || isClosing) {
            return;
          }

          setProcessedArticleBodyHtml(result.html);
          setProcessedArticleBodyKey(activeArticleBodyKey);
          setArticleBodyProcessing(false);
          currentBodyTaskCancelRef.current = null;
        })
        .catch((error: unknown) => {
          if (isDisposed || currentBodyTaskIdRef.current !== taskId || isClosing) {
            return;
          }

          if (error instanceof Error && error.name === 'AbortError') {
            setArticleBodyProcessing(false);
            return;
          }

          console.error('Error preprocessing article body:', error);
          setProcessedArticleBodyHtml(rawArticleBodyHtml);
          setProcessedArticleBodyKey(activeArticleBodyKey);
          setArticleBodyProcessing(false);
          currentBodyTaskCancelRef.current = null;
        });
    }).catch((error) => {
      if (isDisposed || currentBodyTaskIdRef.current !== taskId || isClosing) {
        return;
      }

      console.error('Error starting article preprocessing task:', error);
      setProcessedArticleBodyHtml(rawArticleBodyHtml);
      setProcessedArticleBodyKey(activeArticleBodyKey);
      setArticleBodyProcessing(false);
    });

    return () => {
      isDisposed = true;
      if (currentBodyTaskIdRef.current === taskId) {
        cancelArticleBodyProcessing();
      }
    };
  }, [
    activeArticleBodyKey,
    articleBodyBaseUrl,
    articleResourceType,
    articleViewOverlayPhase,
    articleToShow,
    cancelArticleBodyProcessing,
    clipboardError,
    clipboardLoading,
    isClosing,
    isContentTooLargeForStandalone,
    standalone,
    processedArticleBodyHtml,
    processedArticleBodyKey,
    rawArticleBodyHtml,
    readerError,
    readerLoading,
    currentBodyTaskIdRef,
    currentBodyTaskCancelRef,
    setArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
  ]);
}

// Phase 4: focus the article container when content becomes visible.
function useArticleAutofocus(params: {
  articleHash: string | undefined;
  clipboardLoading: boolean;
  deckOpen: boolean;
  standalone: boolean;
  isClosing: boolean;
  articleToShow: Article | null;
  scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}): void {
  const {
    articleHash,
    clipboardLoading,
    deckOpen,
    standalone,
    isClosing,
    articleToShow,
    scrollContainerRef,
  } = params;

  useDependencyEffect(() => {
    if (isClosing) return;
    if (!scrollContainerRef.current) return;

    const hasVisibleContent = !!articleToShow || clipboardLoading;
    const isVisible = standalone ? hasVisibleContent : hasVisibleContent && deckOpen;
    if (!isVisible) return;

    requestAnimationFrame(() => {
      scrollContainerRef.current?.focus({ preventScroll: true });
    });
  }, [articleHash, clipboardLoading, deckOpen, standalone, isClosing, articleToShow, scrollContainerRef]);
}

// Phase 5: cleanup timers and preprocess tasks on unmount.
function useArticleViewCleanup(
  cancelArticleBodyProcessing: () => void,
  timeoutRef: React.MutableRefObject<number | null>
): void {
  useUnmountEffect(() => {
    cancelArticleBodyProcessing();
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
  });
}

export const ArticleView: React.FC<ArticleViewProps> = ({ article: propArticle, standalone = false, deckOpen = false }) => {
  const nav = standalone ? null : useFeedNavigation();
  const coll = standalone ? null : useFeedCollection();
  const overlay = standalone ? null : useFeedOverlay();

  const selectedSmartView = nav?.selectedSmartView ?? null;
  const articles = coll?.articles ?? [];
  const updateArticleInList = coll?.updateArticleInList ?? (() => {});
  
  const activeArticleHash = overlay?.activeArticleHash ?? null;
  const articleOpenTrigger = overlay?.articleOpenTrigger ?? 0;
  const articleCloseRequest = overlay?.articleCloseRequest ?? 0;
  const requestCloseArticle = overlay?.requestCloseArticle ?? (() => {});
  const completeArticleClose = overlay?.completeArticleClose ?? (() => {});
  const articleViewOverlayPhase = overlay?.articleViewOverlayPhase ?? 'closed';

  const [isClosing, setIsClosing] = useState(false);
  const [articleToShow, setArticleToShow] = useState<Article | null>(propArticle || null);
  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [articleDisplayMode, setArticleDisplayMode] = useState<ArticleDisplayMode>('basic');
  const [readerContent, setReaderContent] = useState<ReaderModeContent | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [articleResourceType, setArticleResourceType] = useState<'html' | 'pdf' | 'unsupported' | null>(null);
  const [pdfViewerLoading, setPdfViewerLoading] = useState(false);
  const [clipboardLoading, setClipboardLoading] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [isTemporaryArticle, setIsTemporaryArticle] = useState(false);
  const [loadingTitle, setLoadingTitle] = useState<string>('');
  const [loadingSource, setLoadingSource] = useState<string>('');
  const [loadingDate, setLoadingDate] = useState<string>('');
  const [hasScrollOffset, setHasScrollOffset] = useState(false);
  const [processedArticleBodyHtml, setProcessedArticleBodyHtml] = useState<string | null>(null);
  const [processedArticleBodyKey, setProcessedArticleBodyKey] = useState<string | null>(null);
  const [articleBodyProcessing, setArticleBodyProcessing] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const lastCloseRequestRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const lastOpenTriggerRef = useRef(0);
  const lastProcessedTriggerRef = useRef(0);
  const currentArticleHashRef = useRef<string | null>(null);
  const standaloneSyncedHashRef = useRef<string | null>(null);
  const currentBodyTaskIdRef = useRef(0);
  const currentBodyTaskCancelRef = useRef<null | (() => Promise<void>)>(null);
  const modeRequestVersionRef = useRef(0);
  const pendingArticleListUpdateRef = useRef<{ hash: string; updates: ArticleListUpdatePayload } | null>(null);
  const readerContentHashRef = useRef<string | null>(null);
  const readerFetchKeyRef = useRef<string | null>(null);

  // In standalone mode, use prop article; otherwise use selected article from context
  const selectedArticle = standalone
    ? propArticle
    : articles.find((article: Article) => article.hash === activeArticleHash);

  const isFeedLinkedArticle = !!articleToShow && (
    articleToShow.isFeedLinked ?? (articleToShow.feedId !== 'clipboard' && articleToShow.feedId !== 'saved')
  );
  const canToggleReaderMode = selectedSmartView !== 'saved';
  const isReaderModeActive = articleDisplayMode === 'reader';
  const articleBodyBaseUrl = articleToShow?.link || articleToShow?.feedUrl;
  const useSavedArticleSnapshot = shouldUseSavedArticleSnapshot(articleToShow, selectedSmartView);
  const rawArticleBodyHtml = isReaderModeActive && !useSavedArticleSnapshot
    ? (readerContent?.content || '')
    : (articleToShow?.content || '');
  // Phase 1: sanitize immediately for first render so users never see raw
  // feed-provided inline styles before async preprocessing finishes.
  const firstPaintSanitizedArticleBodyHtml = sanitizeArticleHtmlStyles(rawArticleBodyHtml);
  const activeArticleBodyKey = articleToShow
    ? `${articleToShow.hash}:${articleDisplayMode}:${articleBodyBaseUrl || ''}`
    : null;
  const audioEnclosure = selectPrimaryAudioEnclosure(articleToShow);
  const shouldRenderPodcastAudio = !!articleToShow
    && !!audioEnclosure
    && !hasInlineAudioMarkup(rawArticleBodyHtml);
  const { isPressed: isTitlePressFeedbackVisible, trigger: triggerTitlePressFeedback } = useTransientPressedState(
    articleToShow?.hash
  );

  const cancelArticleBodyProcessing = useCallback(() => {
    currentBodyTaskIdRef.current += 1;
    const cancel = currentBodyTaskCancelRef.current;
    currentBodyTaskCancelRef.current = null;
    if (cancel) {
      void cancel();
    }
  }, []);

  const clearCurrentReaderContent = useCallback(() => {
    readerContentHashRef.current = null;
    readerFetchKeyRef.current = null;
  }, []);

  // Keep the active row visually stable while the article deck is open.
  // Read, save, and last-read changes are merged here and applied once the
  // view closes or the user switches to another article.
  const queuePendingArticleListUpdate = useCallback((hash: string, updates: ArticleListUpdatePayload) => {
    const existing = pendingArticleListUpdateRef.current;
    if (existing && existing.hash === hash) {
      pendingArticleListUpdateRef.current = {
        hash,
        updates: {
          ...existing.updates,
          ...updates,
        },
      };
      return;
    }

    pendingArticleListUpdateRef.current = { hash, updates };
  }, []);

  const queueOrApplyArticleListUpdate = useCallback((hash: string, updates: ArticleListUpdatePayload) => {
    if (currentArticleHashRef.current === hash) {
      queuePendingArticleListUpdate(hash, updates);
      return;
    }

    updateArticleInList(hash, updates);
  }, [queuePendingArticleListUpdate, updateArticleInList]);

  const flushPendingArticleListUpdate = useCallback(() => {
    const pending = pendingArticleListUpdateRef.current;
    if (!pending) return;
    pendingArticleListUpdateRef.current = null;
    updateArticleInList(pending.hash, pending.updates);
  }, [updateArticleInList]);

  useDependencyEffect(() => {
    if (articleResourceType === 'pdf' && articleToShow?.link) {
      setPdfViewerLoading(true);
    } else {
      setPdfViewerLoading(false);
    }
  }, [articleResourceType, articleToShow?.hash, articleToShow?.link]);

  const handleBack = useCallback(() => {
    if (isClosing) return;
    requestCloseArticle();
  }, [isClosing, requestCloseArticle]);

  const handleOpenInBrowser = useCallback((withPressedFeedback = false) => {
    if (!articleToShow?.link || !window.electronAPI) {
      return;
    }

    if (withPressedFeedback) {
      triggerTitlePressFeedback();
    }

    void window.electronAPI.openExternal(articleToShow.link);
  }, [articleToShow?.link, triggerTitlePressFeedback]);

  const handleOpenInNewWindow = useCallback(async () => {
    if (articleToShow && window.electronAPI) {
      await window.electronAPI.openArticleWindow({
        article: articleToShow,
      });
      // Close the article view after the window is opened
      handleBack();
    }
  }, [articleToShow, handleBack]);

  const buildSavedListUpdatePayload = useCallback((
    saved: boolean,
    savedArticleId?: string
  ): ArticleListUpdatePayload => {
    return { saved, savedArticleId };
  }, []);

  const getInitialSavedState = useCallback((article: Article | null | undefined): boolean => {
    if (!article) {
      return false;
    }

    return !!(article.saved || article.savedArticleId);
  }, []);

  const handleSaveArticle = useCallback(async () => {
    if (!articleToShow || saveLoading) return;

    setSaveLoading(true);
    try {
      let savedArticleId = articleToShow.savedArticleId;

      if (isSaved && !savedArticleId) {
        const existing = await savedArticlesService.findSavedArticle(articleToShow.hash, articleToShow.link);
        savedArticleId = existing?.id;
      }

      if (isSaved && savedArticleId) {
        const unsavedPayload = buildSavedListUpdatePayload(false, undefined);
        // Unsave the article
        await savedArticlesService.unsaveArticle(savedArticleId, articleToShow.title);
        // Only update articlesManager for non-temporary articles
        if (!isTemporaryArticle && isFeedLinkedArticle) {
          await articlesManager.updateSavedStatus(articleToShow.feedId, articleToShow.hash, false);
        }
        setIsSaved(false);
        setArticleToShow({ ...articleToShow, ...unsavedPayload });

        // Update the article in the list (only for non-temporary)
        if (!isTemporaryArticle && isFeedLinkedArticle) {
          queueOrApplyArticleListUpdate(articleToShow.hash, unsavedPayload);
        }
      } else {
        // Save the article
        let contentToSave = shouldSaveLinkOnlyContent(articleResourceType, articleToShow.link)
          ? getLinkOnlySavedContent()
          : getBasicModeContentForSave(articleToShow);
        const youtubeEmbedHtmlFromLink = articleToShow.link
          ? buildYouTubeEmbedHtml(articleToShow.link, articleToShow.title)
          : null;
        const readerContentValue = readerContent?.content?.trim() || '';

        if (!shouldSaveLinkOnlyContent(articleResourceType, articleToShow.link)
          && articleDisplayMode === 'reader') {
          if (!readerError && isSaveableHtmlContent(readerContentValue)) {
            contentToSave = readerContentValue;
          } else if (youtubeEmbedHtmlFromLink) {
            contentToSave = youtubeEmbedHtmlFromLink;
          } else if (articleToShow.link) {
            const readerResult = await readerModeService.fetchAndParse(articleToShow.link);
            if (readerResult.resourceType === 'pdf' || readerResult.resourceType === 'unsupported') {
              contentToSave = getLinkOnlySavedContent();
            } else {
              const fetchedReaderHtml = readerResult.content?.content?.trim() || '';
              if (readerResult.success && isSaveableHtmlContent(fetchedReaderHtml)) {
                contentToSave = fetchedReaderHtml;
              }
            }
          }
        }

        if (!shouldSaveLinkOnlyContent(articleResourceType, articleToShow.link)
          && !isSaveableHtmlContent(contentToSave)) {
          const fallbackReaderContent = readerContent?.content?.trim() || '';
          if (isSaveableHtmlContent(fallbackReaderContent)) {
            contentToSave = fallbackReaderContent;
          }
        }

        const articleToSave = {
          ...articleToShow,
          content: contentToSave,
        };

        const savedArticle = await savedArticlesService.saveArticle(articleToSave);
        // Only update articlesManager for non-temporary articles
        if (!isTemporaryArticle && isFeedLinkedArticle) {
          await articlesManager.updateSavedStatus(
            articleToShow.feedId,
            articleToShow.hash,
            true,
            savedArticle.id
          );
        }
        setIsSaved(true);
        const savedPayload = buildSavedListUpdatePayload(true, savedArticle.id);

        // Keep the live feed body for reader/basic toggles; only attach saved metadata.
        setArticleToShow({ ...articleToShow, ...savedPayload });

        // Update the article in the list (only for non-temporary)
        if (!isTemporaryArticle && isFeedLinkedArticle) {
          queueOrApplyArticleListUpdate(articleToShow.hash, savedPayload);
        }
      }
    } catch (error) {
      console.error('Error saving/unsaving article:', error);
    } finally {
      setSaveLoading(false);
    }
  }, [
    articleDisplayMode,
    articleResourceType,
    articleToShow,
    buildSavedListUpdatePayload,
    isFeedLinkedArticle,
    isSaved,
    isTemporaryArticle,
    queueOrApplyArticleListUpdate,
    readerContent,
    readerError,
    saveLoading,
  ]);

  const syncSavedState = useCallback(async (article: Article) => {
    const existing = await savedArticlesService.findSavedArticle(article.hash, article.link);
    const saved = !!existing;
    const savedArticleId = existing?.id;

    if (currentArticleHashRef.current !== article.hash) {
      return;
    }

    setIsSaved(saved);
    setArticleToShow((prev) => {
      if (!prev || prev.hash !== article.hash) {
        return prev;
      }

      if (prev.saved === saved && prev.savedArticleId === savedArticleId) {
        return prev;
      }

      return {
        ...prev,
        saved,
        savedArticleId,
      };
    });
  }, []);

  const handleShareClick = useCallback(async () => {
    // Show native share menu directly
    if (articleToShow?.title && articleToShow?.link && window.electronAPI && shareButtonRef.current) {
      try {
        const rect = shareButtonRef.current.getBoundingClientRect();
        await window.electronAPI.showShareSheet({
          title: articleToShow.title,
          url: articleToShow.link,
          buttonRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      } catch (error) {
        console.error('Error showing share sheet:', error);
      }
    }
  }, [articleToShow]);

  const handleCopyArticleUrl = useCallback(async () => {
    if (!articleToShow?.link) {
      return;
    }

    try {
      if (!window.electronAPI?.writeClipboard) {
        appToastService.show('Copy is not available in this environment.');
        return;
      }

      await window.electronAPI.writeClipboard(articleToShow.link);
    } catch (error) {
      console.error('Error copying article URL:', error);
      appToastService.show('Failed to copy article URL.');
    }
  }, [articleToShow]);

  const handleArticleLinkClick = useCallback((href: string) => {
    if (!window.electronAPI) {
      return;
    }

    void window.electronAPI.openExternal(resolveYouTubeWatchUrl(href) ?? href);
  }, []);

  const handleArticleContextMenu = useCallback((detail: { kind: 'link' | 'image'; url: string }) => {
    if (!window.electronAPI?.showImageContextMenu) {
      return;
    }

    void (async () => {
      let windowLabel: string | undefined;
      try {
        windowLabel = getCurrentWindow().label;
      } catch {
        windowLabel = undefined;
      }

      try {
        await window.electronAPI.showImageContextMenu({
          url: detail.url,
          kind: detail.kind,
          windowLabel,
        });
      } catch (error) {
        logger.warn('ArticleView', 'Failed to show article context menu', {
          kind: detail.kind,
          url: detail.url,
          error,
        });
      }
    })();
  }, []);

  const handleArticleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (isClosing) return;

    const isScrolled = event.currentTarget.scrollTop > 0;
    setHasScrollOffset((previous) => (previous === isScrolled ? previous : isScrolled));
  }, [isClosing]);

  const updateLastReadTime = useCallback(async (article: Article) => {
    const lastReadAt = new Date().toISOString();
    const isFeedLinked = article.isFeedLinked ?? (article.feedId !== 'clipboard' && article.feedId !== 'saved');

    try {
      if (isFeedLinked) {
        await articlesManager.updateLastReadAt(article.feedId, article.hash, lastReadAt);
      }

      await savedArticlesService.updateLastReadAt(article.hash, article.link, lastReadAt);

      queueOrApplyArticleListUpdate(article.hash, { lastReadAt });
      setArticleToShow((prev) => (prev && prev.hash === article.hash ? { ...prev, lastReadAt } : prev));
    } catch (error) {
      console.error('Error updating last read time:', error);
    }
  }, [queueOrApplyArticleListUpdate]);

  const markArticleAsReadOnOpen = useCallback(async (article: Article, isFeedLinked: boolean) => {
    if (selectedSmartView === 'saved' || !isFeedLinked || article.read) {
      return;
    }

    try {
      await articlesManager.updateReadStatus(article.feedId, article.hash, true);
      queueOrApplyArticleListUpdate(article.hash, { read: true });
      setArticleToShow((prev) => (
        prev && prev.hash === article.hash
          ? { ...prev, read: true }
          : prev
      ));
    } catch (error) {
      console.error('Error marking article as read:', error);
    }
  }, [queueOrApplyArticleListUpdate, selectedSmartView]);

  const fetchReaderContent = useCallback(async (article: Article, requestVersion: number) => {
    const { link: url, hash, title, author, description, feedTitle, feedUrl } = article;
    const fetchKey = `${hash}:${requestVersion}`;
    readerFetchKeyRef.current = fetchKey;

    if (!url) {
      if (readerFetchKeyRef.current === fetchKey) {
        readerFetchKeyRef.current = null;
      }
      setReaderLoading(false);
      return;
    }

    setReaderLoading(true);
    setReaderError(null);

    const youtubeEmbedHtml = buildYouTubeEmbedHtml(url, title);
    if (youtubeEmbedHtml) {
      if (requestVersion !== modeRequestVersionRef.current || currentArticleHashRef.current !== hash) {
        if (readerFetchKeyRef.current === fetchKey) {
          readerFetchKeyRef.current = null;
        }
        return;
      }
      readerContentHashRef.current = hash;
      readerFetchKeyRef.current = null;
      const fallbackTitle = title || 'YouTube video';
      setReaderContent({
        title: fallbackTitle,
        byline: author || undefined,
        content: youtubeEmbedHtml,
        textContent: fallbackTitle,
        length: youtubeEmbedHtml.length,
        excerpt: description || '',
        siteName: feedTitle || feedUrl || 'YouTube',
      });
      setArticleResourceType('html');
      setReaderLoading(false);
      return;
    }

    const result = await readerModeService.fetchAndParse(url);

    if (requestVersion !== modeRequestVersionRef.current || currentArticleHashRef.current !== hash) {
      if (readerFetchKeyRef.current === fetchKey) {
        readerFetchKeyRef.current = null;
      }
      return;
    }

    if (result.resourceType && result.resourceType !== 'html') {
      readerContentHashRef.current = hash;
      readerFetchKeyRef.current = null;
      setArticleResourceType(result.resourceType);
      if (result.resourceType === 'pdf') {
        setPdfViewerLoading(true);
      }
      setReaderLoading(false);
      return;
    }

    if (result.success && result.content) {
      readerContentHashRef.current = hash;
      setReaderContent(result.content);
    } else {
      setReaderError(result.error || 'Failed to fetch article');
    }

    if (readerFetchKeyRef.current === fetchKey) {
      readerFetchKeyRef.current = null;
    }
    setReaderLoading(false);
  }, []);

  const ensureReaderContentForArticle = useCallback((article: Article, requestVersion: number) => {
    if (!article.link) {
      setReaderLoading(false);
      return;
    }

    if (readerContentHashRef.current === article.hash) {
      setReaderLoading(false);
      return;
    }

    const fetchKey = `${article.hash}:${requestVersion}`;
    if (readerFetchKeyRef.current === fetchKey) {
      return;
    }

    void fetchReaderContent(article, requestVersion);
  }, [fetchReaderContent]);

  const configureReaderModeForArticle = useCallback(async (article: Article, isFeedLinked: boolean) => {
    // Phase 2 logic: Actually fetch reader content if mode is enabled
    if (!isFeedLinked || shouldUseSavedArticleSnapshot(article, selectedSmartView)) {
      setArticleDisplayMode('basic');
      setReaderLoading(false);
      return;
    }

    const requestVersion = modeRequestVersionRef.current;
    const feed = await feedsManager.getFeedById(article.feedId);
    if (requestVersion !== modeRequestVersionRef.current || currentArticleHashRef.current !== article.hash) {
      return;
    }
    const shouldUseReaderMode = feed?.readerModeEnabled || false;
    
    // Update cache and state just in case Phase 1 missed it
    rememberFeedReaderMode(article.feedId, shouldUseReaderMode);
    setArticleDisplayMode(shouldUseReaderMode ? 'reader' : 'basic');

    if (shouldUseReaderMode && article.link) {
      ensureReaderContentForArticle(article, requestVersion);
    } else {
      setReaderLoading(false);
    }
  }, [ensureReaderContentForArticle, selectedSmartView]);

  const handleClipboardLoad = useCallback(async () => {
    if (!window.electronAPI) return;

    // Clear old article metadata immediately
    setArticleToShow(null);
    setClipboardLoading(true);
    setClipboardError(null);
    setLoadingTitle('Fetching article...');
    setLoadingSource('');
    setLoadingDate('');

    try {
      // Read clipboard
      const clipboardText = await window.electronAPI.readClipboard();

      // Validate and extract URL
      const url = extractUrlFromText(clipboardText);
      if (!url) {
        setClipboardError('No valid URL found in clipboard');
        setClipboardLoading(false);
        return;
      }

      // Extract hostname for early display
      let hostname = url;
      try {
        hostname = new URL(url).hostname;
        setLoadingSource(hostname);
      } catch {
        // Keep original URL if parsing fails
      }

      const readerResult = await readerModeService.fetchAndParse(url);

      // Check for non-HTML resource types from reader result
      if (readerResult.resourceType && readerResult.resourceType !== 'html') {
        const nowIso = new Date().toISOString();
        setArticleResourceType(readerResult.resourceType);
        setArticleDisplayMode('reader');
        setClipboardLoading(false);
        // Create a minimal article so the view can render the inline PDF viewer / empty state
        setArticleToShow({
          hash: url,
          title: hostname,
          content: '',
          link: url,
          feedId: 'clipboard',
          feedTitle: hostname,
          publishedDate: nowIso,
          read: false,
          starred: false,
          saved: false,
        } as Article);
        setIsTemporaryArticle(true);
        setLoadingTitle('');
        setLoadingSource('');
        setLoadingDate('');
        return;
      }

      const postlightResult = await postlightParserService.parseUrl(url);

      if (!postlightResult.success || !postlightResult.content) {
        setClipboardError(postlightResult.error || 'Could not extract article content');
        setClipboardLoading(false);
        return;
      }

      const selectedHtmlContent = selectArticleHtmlContent({
        postlightHtml: postlightResult.content.content,
        readerHtml: readerResult.success ? readerResult.content?.content : null,
      });

      // Update loading state with extracted metadata immediately
      if (postlightResult.content.title) {
        setLoadingTitle(postlightResult.content.title);
      }
      if (postlightResult.content.siteName || postlightResult.content.domain) {
        setLoadingSource(postlightResult.content.siteName || postlightResult.content.domain || hostname);
      }
      if (postlightResult.content.datePublished) {
        const loadingDate = normalizePublishedDate(postlightResult.content.datePublished);
        if (loadingDate) {
          setLoadingDate(loadingDate);
        }
      }

      // Fetch favicon (non-blocking)
      let favicon: string | undefined;
      try {
        favicon = (await faviconFetcher.fetchFavicon(url)) || undefined;
      } catch (error) {
        console.warn('Failed to fetch favicon for clipboard article:', error);
      }

      // Create temporary article with Postlight metadata
      const tempArticle = await createTemporaryArticleFromPostlight(url, {
        ...postlightResult.content,
        content: selectedHtmlContent || postlightResult.content.content,
      }, favicon);

      // Update state
      setArticleToShow(tempArticle);
      setIsTemporaryArticle(true);
      setArticleDisplayMode('reader');
      // Keep reader mode content in sync with selected HTML (prefer media-aware reader HTML when needed).
      if (selectedHtmlContent) {
        const fallbackTextContent = selectedHtmlContent.replace(/<[^>]*>/g, '').trim();
        setReaderContent({
          content: selectedHtmlContent,
          title: postlightResult.content.title || readerResult.content?.title || '',
          byline: postlightResult.content.author || readerResult.content?.byline || '',
          siteName: postlightResult.content.siteName || postlightResult.content.domain || readerResult.content?.siteName || '',
          textContent: readerResult.success ? (readerResult.content?.textContent || fallbackTextContent) : fallbackTextContent,
          length: selectedHtmlContent.length,
          excerpt: postlightResult.content.excerpt || readerResult.content?.excerpt || '',
        });
      }
      void syncSavedState(tempArticle);
      setClipboardLoading(false);
      setClipboardError(null);
      setLoadingTitle('');
      setLoadingSource('');
      setLoadingDate('');
    } catch (error) {
      console.error('Error loading article from clipboard:', error);
      setClipboardError(error instanceof Error ? error.message : 'Failed to load article');
      setClipboardLoading(false);
      setLoadingTitle('');
      setLoadingSource('');
      setLoadingDate('');
    }
  }, [syncSavedState]);

  const handleReaderModeToggle = useCallback(async (nextStateIndex: number) => {
    if (!articleToShow || !isFeedLinkedArticle) return;

    const newMode: ArticleDisplayMode = nextStateIndex === 1 ? 'reader' : 'basic';
    const requestVersion = modeRequestVersionRef.current + 1;
    modeRequestVersionRef.current = requestVersion;
    setArticleDisplayMode(newMode);
    setReaderError(null);

    // Only update feed config for non-temporary articles
    if (!isTemporaryArticle && isFeedLinkedArticle) {
      void feedsManager.updateFeed(articleToShow.feedId, {
        readerModeEnabled: newMode === 'reader'
      }).catch((error) => {
        console.error('Error updating reader mode:', error);
      });
      rememberFeedReaderMode(articleToShow.feedId, newMode === 'reader');
    }

    if (newMode === 'reader') {
      // If enabling and no reader content yet, wait for fetch before flipping visual state.
      if (articleToShow.link && readerContentHashRef.current !== articleToShow.hash) {
        ensureReaderContentForArticle(articleToShow, requestVersion);
      } else {
        setReaderLoading(false);
      }
    } else {
      // If disabling, immediately stop reader-only loading and ignore in-flight reader responses.
      setReaderLoading(false);
      setArticleResourceType((current) => {
        if (current === 'pdf') {
          readerContentHashRef.current = null;
          return null;
        }
        return current;
      });
    }
  }, [articleToShow, isTemporaryArticle, isFeedLinkedArticle, ensureReaderContentForArticle]);

  // Define reader mode button states
  const readerModeStates: ButtonState[] = [
    {
      key: 'basic',
      icon: <ArticleOutlinedIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: withShortcutHint(TOOLTIPS.articleView.readerModeEnable, SHORTCUT_LABELS.TOGGLE_READER_MODE),
      title: withShortcutHint(TOOLTIPS.articleView.readerModeEnable, SHORTCUT_LABELS.TOGGLE_READER_MODE),
    },
    {
      key: 'reader',
      icon: <ArticleIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: withShortcutHint(TOOLTIPS.articleView.readerModeDisable, SHORTCUT_LABELS.TOGGLE_READER_MODE),
      title: withShortcutHint(TOOLTIPS.articleView.readerModeDisable, SHORTCUT_LABELS.TOGGLE_READER_MODE),
    },
  ];

  // Define save button states
  const saveButtonStates: ButtonState[] = [
    {
      key: 'unsaved',
      icon: <ArchiveOutlinedIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: withShortcutHint(TOOLTIPS.articleView.saveArticle, SHORTCUT_LABELS.SAVE_ARTICLE),
      title: withShortcutHint(TOOLTIPS.articleView.saveArticle, SHORTCUT_LABELS.SAVE_ARTICLE),
    },
    {
      key: 'saved',
      icon: <ArchiveIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: withShortcutHint(TOOLTIPS.articleView.unsaveArticle, SHORTCUT_LABELS.SAVE_ARTICLE),
      title: withShortcutHint(TOOLTIPS.articleView.unsaveArticle, SHORTCUT_LABELS.SAVE_ARTICLE),
    },
  ];

  // Phase 0: synchronize derived article identity.
  useCurrentArticleTracking(articleToShow?.hash, currentArticleHashRef);

  // Phase 1: open bootstrap for standalone and embedded article views.
  useStandaloneArticleBootstrap({
    standalone,
    propArticle,
    isTemporaryArticle,
    modeRequestVersionRef,
    currentArticleHashRef,
    standaloneSyncedHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    configureReaderModeForArticle,
    syncSavedState,
    updateLastReadTime,
    markArticleAsReadOnOpen,
  });
  useEmbeddedArticleOpenBootstrap({
    standalone,
    selectedSmartView,
    selectedArticle: selectedArticle || undefined,
    articleOpenTrigger,
    lastOpenTriggerRef,
    timeoutRef,
    flushPendingArticleListUpdate,
    setIsClosing,
    currentArticleHashRef,
    setIsSaved,
    getInitialSavedState,
    setArticleToShow,
    clearCurrentReaderContent,
    setReaderContent,
    setReaderError,
    setReaderLoading,
    setArticleResourceType,
    modeRequestVersionRef,
    cancelArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    setArticleBodyProcessing,
    setArticleDisplayMode,
    ensureReaderContentForArticle,
    setIsTemporaryArticle,
    setClipboardError,
    markArticleAsReadOnOpen,
  });
  // Phase 1b: close requests are coordinated here so ArticleView remains the
  // single owner of animation teardown, while FeedContext owns the shared
  // overlay lifecycle state used by shortcuts and app chrome.
  useEmbeddedArticleCloseFlow({
    standalone,
    articleCloseRequest,
    articleToShow,
    isClosing,
    lastCloseRequestRef,
    timeoutRef,
    cancelArticleBodyProcessing,
    setArticleBodyProcessing,
    setIsClosing,
    flushPendingArticleListUpdate,
    setArticleToShow,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
    setArticleResourceType,
    completeArticleClose,
  });

  // Phase 2: post-open async synchronization.
  useEmbeddedArticlePostOpenSync({
    standalone,
    selectedArticle: selectedArticle || undefined,
    articleOpenTrigger,
    articleViewOverlayPhase,
    lastProcessedTriggerRef,
    syncSavedState,
    configureReaderModeForArticle,
    updateLastReadTime,
  });

  // Phase 3: interaction wiring.
  useArticleViewKeyboardShortcuts({
    standalone,
    articleToShow,
    isFeedLinkedArticle,
    isClosing,
    handleBack,
    articleDisplayMode,
    handleReaderModeToggle,
    clipboardLoading,
    saveLoading,
    canToggleReaderMode,
    handleSaveArticle,
    handleClipboardLoad,
    handleCopyArticleUrl,
    handleOpenInBrowser,
    handleOpenInNewWindow,
    scrollContainerRef,
  });

  // Keep container mounted while deck is open/closing so panel slide animation remains visible.
  const shouldRenderContainer = standalone
    ? !!articleToShow || clipboardLoading
    : !!articleToShow || clipboardLoading || deckOpen || isClosing;
  const isContentTooLargeForStandalone = standalone
    && !clipboardLoading
    && (articleToShow?.content?.length ?? 0) > STANDALONE_CONTENT_GUARD_THRESHOLD;

  useArticleScrollState({
    articleHash: articleToShow?.hash,
    clipboardLoading,
    scrollContainerRef,
    setHasScrollOffset,
  });

  // Phase 4: body preprocessing and focus readiness.
  useArticleBodyPreprocessing({
    activeArticleBodyKey,
    articleBodyBaseUrl,
    articleResourceType,
    articleViewOverlayPhase,
    articleToShow,
    cancelArticleBodyProcessing,
    clipboardError,
    clipboardLoading,
    isClosing,
    isContentTooLargeForStandalone,
    standalone,
    processedArticleBodyHtml,
    processedArticleBodyKey,
    rawArticleBodyHtml,
    readerError,
    readerLoading,
    currentBodyTaskIdRef,
    currentBodyTaskCancelRef,
    setArticleBodyProcessing,
    setProcessedArticleBodyHtml,
    setProcessedArticleBodyKey,
  });
  useArticleAutofocus({
    articleHash: articleToShow?.hash,
    clipboardLoading,
    deckOpen,
    standalone,
    isClosing,
    articleToShow,
    scrollContainerRef,
  });
  useArticleViewCleanup(cancelArticleBodyProcessing, timeoutRef);
  const { handleArticleViewProfilerRender } = useArticleViewPerformanceMetrics({
    standalone,
    articleOpenTrigger,
    articleCloseRequest,
    articleViewOverlayPhase,
    deckOpen,
    selectedArticleHash: selectedArticle?.hash ?? null,
    articleToShowHash: articleToShow?.hash ?? null,
    articleDisplayMode,
    isFeedLinkedArticle,
    readerLoading,
    articleBodyProcessing,
    clipboardLoading,
    articleResourceType,
    rawArticleBodyHtml,
  });

  const renderBodyContent = () => {
    const mediaProcessingDelayMs = standalone || articleViewOverlayPhase === 'open'
      ? 0
      : ARTICLE_VIEW_OPENING_MS;

    if (clipboardLoading) {
      return (
        <motion.div
          key="clipboard-loading"
          className="reader-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <ArticleContentSkeleton />
        </motion.div>
      );
    }

    if (clipboardError) {
      return (
        <motion.div
          key="clipboard-error"
          className="reader-error"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <p>{clipboardError}</p>
        </motion.div>
      );
    }

    if (!articleToShow) {
      return <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />;
    }

    const podcastAudio = shouldRenderPodcastAudio && audioEnclosure ? (
      <ArticlePodcastAudio article={articleToShow} enclosure={audioEnclosure} />
    ) : null;

    if (articleResourceType === 'pdf' && articleToShow.link) {
      return (
        <motion.div
          key="pdf-panel"
          className="article-view-pdf-panel"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {podcastAudio}
          {pdfViewerLoading && (
            <div className="article-view-pdf-loading-overlay reader-loading" aria-busy="true" aria-label="Loading PDF">
              <ArticleContentSkeleton />
            </div>
          )}
          <ArticlePdfViewer
            key={`${articleToShow.hash}:${articleToShow.link}`}
            url={articleToShow.link}
            suspendProcessing={isClosing}
            onOpenInBrowser={handleOpenInBrowser}
            onLoadStart={() => setPdfViewerLoading(true)}
            onFirstPageRendered={() => setPdfViewerLoading(false)}
            onLoadError={() => setPdfViewerLoading(false)}
          />
        </motion.div>
      );
    }

    if (articleResourceType === 'unsupported') {
      return (
        <motion.div
          key="unsupported"
          className="reader-error"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {podcastAudio}
          <p>This content type cannot be displayed inline.</p>
          {articleToShow.link ? <p>Press `O` to open it in your browser.</p> : null}
        </motion.div>
      );
    }

    if (isContentTooLargeForStandalone) {
      return (
        <motion.div
          key="content-guard"
          className="reader-error"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {podcastAudio}
          <p>Article content is too large for stable standalone rendering.</p>
          {articleToShow.link ? <p>Press `O` to open it in your browser.</p> : null}
        </motion.div>
      );
    }

    if (isReaderModeActive) {
      if (readerError) {
        return (
          <motion.div
            key="error"
            className="reader-error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {podcastAudio}
            <p>{readerError}</p>
          </motion.div>
        );
      }

      if (readerLoading || !readerContent) {
        return (
          <motion.div
            key="reader-processing"
            className="reader-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {podcastAudio}
            <ArticleContentSkeleton />
          </motion.div>
        );
      }

      const readerHtmlToRender = (
        articleBodyProcessing
        || processedArticleBodyKey !== activeArticleBodyKey
        || processedArticleBodyHtml === null
      )
        ? firstPaintSanitizedArticleBodyHtml
        : processedArticleBodyHtml;

      return (
        <motion.div
          key="reader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {podcastAudio}
          <ArticleContent
            htmlContent={readerHtmlToRender}
            baseUrl={articleToShow?.link || articleToShow?.feedUrl}
            onLinkClick={handleArticleLinkClick}
            onArticleContextMenu={handleArticleContextMenu}
            mediaProcessingDelayMs={mediaProcessingDelayMs}
            suspendProcessing={isClosing}
          />
        </motion.div>
      );
    }

    const originalHtmlToRender = (
      articleBodyProcessing
      || processedArticleBodyKey !== activeArticleBodyKey
      || processedArticleBodyHtml === null
    )
      ? (firstPaintSanitizedArticleBodyHtml.trim() ? firstPaintSanitizedArticleBodyHtml : (articleToShow.description || ''))
      : processedArticleBodyHtml;

    return (
      <motion.div
        key="original"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {podcastAudio}
        <ArticleContent
          htmlContent={originalHtmlToRender}
          baseUrl={articleToShow?.link || articleToShow?.feedUrl}
          onLinkClick={handleArticleLinkClick}
          onArticleContextMenu={handleArticleContextMenu}
          mediaProcessingDelayMs={mediaProcessingDelayMs}
          suspendProcessing={isClosing}
        />
      </motion.div>
    );
  };

  if (!shouldRenderContainer) {
    return null;
  }

  return (
    <InteractionProfiler id={`article-view:${articleToShow?.hash ?? selectedArticle?.hash ?? 'empty'}`} onRender={handleArticleViewProfilerRender}>
      <motion.div
        className={standalone ? "article-view article-view-window" : "article-view article-view-embedded"}
        data-section="article-view"
        data-component="article-view"
        data-entity-id={articleToShow?.hash}
        initial={standalone ? { opacity: 0 } : false}
        animate={
          standalone
            ? { opacity: 1 }
            : {
                x: 0,
              }
        }
        transition={{
          ...(standalone
            ? { type: 'spring' as const, bounce: 0.05, duration: 0.3 }
            : { duration: 0 }),
        }}
      >
        <div
          className={`article-view-header-bar ${hasScrollOffset ? 'article-view-header-bar-scrolled' : ''}`}
          data-section="article-view-header"
          data-component="article-header-bar"
        >
          <motion.div
            className="article-view-header-chrome"
            initial={false}
            animate={isClosing ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
            transition={ARTICLE_VIEW_ELEMENT_TRANSITION}
          >
            {!standalone && (
              <button
                onClick={handleBack}
                className="button is-text is-small article-view-back-button has-no-drag"
                aria-label={withShortcutHint(TOOLTIPS.articleView.back, SHORTCUT_HINTS.CLOSE_ARTICLE_VIEW)}
                title={withShortcutHint(TOOLTIPS.articleView.back, SHORTCUT_HINTS.CLOSE_ARTICLE_VIEW)}
                data-widget="back"
                data-action="close-article"
              >
                <span className="icon">
                  <ArrowBackIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
                </span>
              </button>
            )}
            <div className="article-view-actions has-no-drag" data-component="article-actions">
              {isFeedLinkedArticle && canToggleReaderMode && (
                <StatefulButtonGroup
                  states={readerModeStates}
                  currentStateIndex={articleDisplayMode === 'reader' ? 1 : 0}
                  onChange={handleReaderModeToggle}
                  animationConfig={{
                    direction: 'auto',
                    duration: 0,
                  }}
                  className={`article-view-action-button ${articleDisplayMode === 'reader' ? 'is-active' : ''}`}
                  isLoading={clipboardLoading || (articleDisplayMode === 'reader' && readerLoading)}
                  disabled={!articleToShow?.link}
                  data-widget="reader-mode"
                />
              )}
              <StatefulButtonGroup
                states={saveButtonStates}
                currentStateIndex={isSaved ? 1 : 0}
                onChange={handleSaveArticle}
                animationConfig={{
                  direction: 'auto',
                  duration: 0,
                }}
                className={`article-view-action-button ${isSaved ? 'is-active' : ''}`}
                isLoading={saveLoading}
                disabled={!articleToShow || clipboardLoading}
                data-widget="save-article"
                data-action={isSaved ? "unsave-article" : "save-article"}
              />
              <button
                ref={shareButtonRef}
                onClick={handleShareClick}
                className="button is-text is-small article-view-action-button"
                aria-label={TOOLTIPS.articleView.shareArticle}
                title={TOOLTIPS.articleView.shareArticle}
                disabled={!articleToShow || clipboardLoading}
                data-widget="share-article"
                data-action="share-article"
              >
                <span className="icon">
                  <MoreVertIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
                </span>
              </button>
            </div>
          </motion.div>
        </div>
        <div
          ref={scrollContainerRef}
          className="article-view-scroll"
          tabIndex={-1}
          onScroll={handleArticleScroll}
          data-component="article-scroll-container"
        >
          <motion.article
            className="article-view-content"
            data-component="article-body"
            initial={false}
            animate={isClosing ? { opacity: 0, y: 18, scale: 0.992 } : { opacity: 1, y: 0, scale: 1 }}
            transition={ARTICLE_VIEW_ELEMENT_TRANSITION}
          >
            <header className="article-view-header" data-component="article-meta-header">
              {clipboardLoading ? (
                <div className="article-view-header-loading" data-component="clipboard-loading-state">
                  <motion.div
                    key={loadingTitle || 'loading'}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="article-view-header-loading-content"
                  >
                    {loadingDate ? (
                      <div className="article-view-timestamp" style={{ opacity: 0.6 }} data-component="loading-date">
                        {new Date(loadingDate).toLocaleDateString()}
                      </div>
                    ) : loadingSource ? (
                      <div className="article-view-timestamp" style={{ opacity: 0.5 }} data-component="loading-source">
                        {loadingSource}
                      </div>
                    ) : null}
                    <h1 className="article-view-title" style={{ opacity: 0.7 }} data-component="loading-title">
                      {renderTextWithNonAsciiFont(loadingTitle || 'Fetching article from URL...', 'loading-title')}
                    </h1>
                    <div className="article-view-source-section" style={{ opacity: 0.5 }}>
                      <div className="article-view-source-feed">
                        <span className="article-view-source-feed-title">
                          {renderTextWithNonAsciiFont(loadingSource || 'Extracting metadata...', 'loading-source')}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </div>
              ) : articleToShow && (
                <div
                  className={`article-view-header-clickable${isTitlePressFeedbackVisible ? ' is-pressed' : ''}`}
                  onClick={() => {
                    handleOpenInBrowser();
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={withShortcutHint(TOOLTIPS.articleView.titleOpenInBrowser, SHORTCUT_LABELS.OPEN_IN_BROWSER)}
                  title={withShortcutHint(TOOLTIPS.articleView.titleOpenInBrowser, SHORTCUT_LABELS.OPEN_IN_BROWSER)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenInBrowser(true);
                    }
                  }}
                  style={{ cursor: articleToShow?.link ? 'pointer' : 'default' }}
                  data-action="open-in-browser"
                >
                  <h1 className="article-view-title" data-component="article-title">
                    {renderTextWithNonAsciiFont(articleToShow.title, `${articleToShow.hash}-title`)}
                  </h1>
                  {(articleToShow.feedTitle || articleToShow.author) && (
                    <div className="article-view-source-section" data-section="article-view-source-name" data-component="article-source-info">
                      {articleToShow.author && (
                        <div className="article-view-source-author" data-component="article-author">
                          {renderTextWithNonAsciiFont(articleToShow.author, `${articleToShow.hash}-author`)}
                        </div>
                      )}
                      {articleToShow.feedTitle && (
                        <div className="article-view-source-feed">
                          <span className="article-view-source-feed-title" data-section="article-view-source-title" data-component="article-feed-title">
                            {renderTextWithNonAsciiFont(articleToShow.feedTitle, `${articleToShow.hash}-feed-title`)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </header>
            <div className="article-view-body" data-section="article-content" data-component="article-html-content">
              <AnimatePresence mode="wait">
                {renderBodyContent()}
              </AnimatePresence>
            </div>
          </motion.article>
        </div>
      </motion.div>
    </InteractionProfiler>
  );
};
