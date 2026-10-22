import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import RssFeedRoundedIcon from '@mui/icons-material/RssFeedRounded';
import ListAltRoundedIcon from '@mui/icons-material/ListAltRounded';
import BookmarksRoundedIcon from '@mui/icons-material/BookmarksRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Modal } from '@/components/common/Modal';
import { useFeedNavigation, useFeedUIActions } from '@/contexts/FeedContext';
import * as articleStore from '@/stores/articleStore';
import { feedsManager } from '@/services/feeds/feedsManager';
import type { FeedFetchResult } from '@/services/feeds/feedsFetcher';
import {
  discoverFeeds,
  fetchChosenFeed,
  feedTypeLabel,
  type FeedCandidate,
} from '@/services/feeds/feedAutodiscovery';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { parseOpmlEntries } from '@/services/feeds/opmlImportService';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import {
  fetchOpmlTextFromUrl,
  formatOpmlImportSummary,
  importOpmlTextIntoLibrary,
  isLikelyOpmlUrl,
  navigateAfterOpmlImport,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { appToastService } from '@/services/ui/appToastService';
import { logger } from '@/services/logger';
import {
  describeFileImportError,
  describeLinkError,
  extractFeedTitleFromXml,
  formatExistingSubscriptionMessage,
  hostLabel,
  normalizeLinkInput,
  pluralize,
} from './addFeedModalCopy';
import './AddFeedModal.css';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFeedAdded: (feedId: string, feedUrl: string, feedTitle: string) => void;
}

type AddFeedTab = 'link' | 'file';

interface FaviconLookup {
  favicon?: string;
  faviconFetchFailed: boolean;
}

type LinkPreview =
  | { kind: 'idle' }
  | { kind: 'checking'; url: string }
  | { kind: 'choices'; url: string; candidates: FeedCandidate[] }
  | {
    kind: 'feed';
    /** What the user typed; the preview only applies while it still matches. */
    url: string;
    /** The feed address that is subscribed (differs from url after discovery). */
    feedUrl: string;
    title: string | null;
    fetchResult: FeedFetchResult;
    xmlText: string;
    itemCount: number;
    recentTitles: string[];
    /** Set when the page offered several feeds, so the user can pick another. */
    choices?: FeedCandidate[];
  }
  | { kind: 'existing'; url: string; feed: { id: string; url: string; title: string; tags: string[] } }
  | { kind: 'opml'; url: string; opmlText: string; feedCount: number }
  | { kind: 'error'; url: string; message: string };

type BusyAction = 'adding' | 'importing' | null;

/** Wait this long after typing stops before looking a link up. */
export const LINK_LOOKUP_DEBOUNCE_MS = 500;

const TABS: Array<{ id: AddFeedTab; label: string }> = [
  { id: 'link', label: 'From a link' },
  { id: 'file', label: 'From a file' },
];

const lookUpFavicon = async (feedUrl: string, xmlText: string): Promise<FaviconLookup> => {
  try {
    const favicon = (await faviconFetcher.fetchFavicon(feedUrl, xmlText)) ?? undefined;
    if (!favicon) {
      return { faviconFetchFailed: true };
    }
    if (!favicon.startsWith('data:')) {
      logger.warn('AddFeedModal', 'Favicon lookup returned a non-data URL');
      return { faviconFetchFailed: true };
    }
    return { favicon, faviconFetchFailed: false };
  } catch (error) {
    logger.warn('AddFeedModal', 'Favicon lookup failed during feed preview', { error });
    return { faviconFetchFailed: true };
  }
};

const Spinner: React.FC = () => <span className="add-feed-spinner" aria-hidden="true" />;

// SF Symbols–style line glyphs (24-unit grid, currentColor) for the feed pick list.
const glyphProps = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const FeedGlyph: React.FC = () => (
  <svg {...glyphProps}>
    <circle cx="6.5" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
    <path d="M5 11a8 8 0 0 1 8 8" />
    <path d="M5 5a14 14 0 0 1 14 14" />
  </svg>
);

const ChevronGlyph: React.FC = () => (
  <svg {...glyphProps} className="add-feed-choice-chevron">
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

export const AddFeedModal: React.FC<AddFeedModalProps> = ({
  isOpen,
  onClose,
  onFeedAdded,
}) => {
  const [activeTab, setActiveTab] = useState<AddFeedTab>('link');
  const [linkInput, setLinkInput] = useState('');
  const [preview, setPreview] = useState<LinkPreview>({ kind: 'idle' });
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { refreshTotalFeeds, notifyFeedLibraryChanged } = useFeedUIActions();
  const { selectFeed, selectTag } = useFeedNavigation();

  // Each lookup gets a token; results for an older token are dropped so a
  // slow answer for a previous link never replaces the current preview.
  const lookupTokenRef = useRef(0);
  const faviconLookupRef = useRef<{ url: string; promise: Promise<FaviconLookup> } | null>(null);
  const savedFileInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<AddFeedTab, HTMLButtonElement | null>>({ link: null, file: null });
  const baseId = useId();
  const isBusy = busy !== null;

  const resetLink = useCallback(() => {
    lookupTokenRef.current += 1;
    faviconLookupRef.current = null;
    setPreview({ kind: 'idle' });
    setFaviconPreview(null);
  }, []);

  // Every open starts fresh on the link tab.
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('link');
    setLinkInput('');
    setFileError(null);
    setBusy(null);
    resetLink();
  }, [isOpen, resetLink]);

  // Shows the preview for a found feed, or "already followed" when the
  // discovered address is one the user has.
  const showFeed = useCallback(async (
    url: string,
    feedUrl: string,
    fetchResult: FeedFetchResult,
    isCurrent: () => boolean,
    choices?: FeedCandidate[],
  ) => {
    if (feedUrl !== url) {
      const existingFeed = await feedsManager.getFeedByUrl(feedUrl);
      if (!isCurrent()) return;
      if (existingFeed) {
        setPreview({
          kind: 'existing',
          url,
          feed: {
            id: existingFeed.id,
            url: existingFeed.url,
            title: existingFeed.title,
            tags: existingFeed.tags ?? [],
          },
        });
        return;
      }
    }

    if (fetchResult.notModified || !fetchResult.data) {
      throw new Error('Received empty response from feed URL');
    }

    const xmlText = fetchResult.data;
    const items = fetchResult.items ?? [];
    const faviconPromise = lookUpFavicon(feedUrl, xmlText);
    faviconLookupRef.current = { url: feedUrl, promise: faviconPromise };
    void faviconPromise
      .then((result) => {
        if (isCurrent() && result.favicon) setFaviconPreview(result.favicon);
      })
      .catch((error) => {
        logger.warn('AddFeedModal', 'Favicon preview update failed', { error });
      });

    setPreview({
      kind: 'feed',
      url,
      feedUrl,
      title: extractFeedTitleFromXml(xmlText),
      fetchResult,
      xmlText,
      itemCount: items.length,
      recentTitles: items
        .map((item) => item.title?.trim())
        .filter((title): title is string => Boolean(title))
        .slice(0, 3),
      choices,
    });
  }, []);

  // Each lookup (or pick from the list) takes a new token; see lookupTokenRef.
  const startLookup = useCallback(() => {
    const token = ++lookupTokenRef.current;
    faviconLookupRef.current = null;
    setFaviconPreview(null);
    return () => lookupTokenRef.current === token;
  }, []);

  // A feed picked from the page's list: fetch it once; Add reuses that fetch.
  const chooseFeed = async (url: string, candidate: FeedCandidate, choices: FeedCandidate[]) => {
    const isCurrent = startLookup();
    setPreview({ kind: 'checking', url });
    try {
      const chosen = await fetchChosenFeed(candidate.url, { isCurrent });
      if (!isCurrent()) return;
      await showFeed(url, chosen.feedUrl, chosen.fetchResult, isCurrent, choices);
    } catch (error) {
      if (!isCurrent()) return;
      logger.warn('AddFeedModal', 'Chosen feed lookup failed', { url: candidate.url, error });
      setPreview({ kind: 'error', url, message: describeLinkError(error) });
    }
  };

  const showChoicesAgain = (feedPreview: Extract<LinkPreview, { kind: 'feed' }>) => {
    if (!feedPreview.choices) return;
    startLookup();
    setPreview({ kind: 'choices', url: feedPreview.url, candidates: feedPreview.choices });
  };

  const lookUpLink = useCallback(async (url: string) => {
    const isCurrent = startLookup();
    setPreview({ kind: 'checking', url });

    try {
      if (isLikelyOpmlUrl(url)) {
        const opmlText = await fetchOpmlTextFromUrl(url);
        if (!isCurrent()) return;
        const feedCount = parseOpmlEntries(opmlText, { url }).length;
        setPreview({ kind: 'opml', url, opmlText, feedCount });
        return;
      }

      const existingFeed = await feedsManager.getFeedByUrl(url);
      if (!isCurrent()) return;
      if (existingFeed) {
        setPreview({
          kind: 'existing',
          url,
          feed: {
            id: existingFeed.id,
            url: existingFeed.url,
            title: existingFeed.title,
            tags: existingFeed.tags ?? [],
          },
        });
        return;
      }

      const discovery = await discoverFeeds(url, { isCurrent });
      if (!isCurrent()) return;
      if (discovery.kind === 'choices') {
        setPreview({ kind: 'choices', url, candidates: discovery.candidates });
        return;
      }
      await showFeed(url, discovery.feedUrl, discovery.fetchResult, isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      logger.warn('AddFeedModal', 'Link lookup failed', { url, error });
      setPreview({ kind: 'error', url, message: describeLinkError(error) });
    }
  }, [showFeed, startLookup]);

  // Look the link up shortly after the user stops typing or pastes.
  const normalizedLink = normalizeLinkInput(linkInput);
  useEffect(() => {
    if (!isOpen || !normalizedLink) return;
    const timer = window.setTimeout(() => {
      void lookUpLink(normalizedLink);
    }, LINK_LOOKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, lookUpLink, normalizedLink]);

  const finishAndClose = () => {
    setLinkInput('');
    resetLink();
    setFileError(null);
    onClose();
  };

  const handleClose = () => {
    if (isBusy) return;
    finishAndClose();
  };

  const addPreviewedFeed = async (feedPreview: Extract<LinkPreview, { kind: 'feed' }>) => {
    setBusy('adding');
    const { url, feedUrl, title, fetchResult, xmlText, itemCount } = feedPreview;

    try {
      const faviconLookup = faviconLookupRef.current?.url === feedUrl
        ? await faviconLookupRef.current.promise
        : await lookUpFavicon(feedUrl, xmlText);

      const addedFeed = await feedsManager.addFeed(feedUrl, title || undefined, {
        id: feedsManager.generateId(),
        skipMetadataFetch: true,
        skipFaviconRefresh: true,
      });

      // The subscription row now exists. Initial article storage and favicon
      // persistence are best-effort: failing them must not report "failed to
      // add" (a retry would only find it already subscribed). Selecting the
      // feed below refetches, since lastFetched stays unset when storage failed.
      if (itemCount > 0) {
        try {
          await storeParsedFeedContent({
            feedId: addedFeed.id,
            feedUrl: addedFeed.url,
            feed: addedFeed,
            feedTitle: addedFeed.title,
            rawText: xmlText,
          });

          const syncedCounts = await articleStore.syncFeedCountsBatch([addedFeed.id]);
          const counts = syncedCounts[0];
          await feedsManager.updateFeed(addedFeed.id, {
            lastFetched: new Date(),
            etag: fetchResult.etag,
            lastModifiedHeader: fetchResult.lastModified,
            articleCount: counts?.articleCount ?? itemCount,
            unreadCount: counts?.unreadCount ?? itemCount,
          });

          if (counts) {
            feedLibraryMutationBus.publishFeedsCountsUpdated([{
              feedId: addedFeed.id,
              unreadCount: counts.unreadCount,
              articleCount: counts.articleCount,
            }]);
          }
        } catch (storeError) {
          logger.warn('AddFeedModal', 'Initial article storage failed after adding feed', {
            feedId: addedFeed.id,
            error: storeError,
          });
        }
      }

      if (faviconLookup.favicon || faviconLookup.faviconFetchFailed) {
        try {
          await feedsManager.updateFeed(addedFeed.id, {
            favicon: faviconLookup.favicon,
            faviconFetchFailed: faviconLookup.faviconFetchFailed,
          });
        } catch (faviconError) {
          logger.warn('AddFeedModal', 'Favicon update failed after adding feed', {
            feedId: addedFeed.id,
            error: faviconError,
          });
        }
      }

      setBusy(null);
      onFeedAdded(addedFeed.id, addedFeed.url, addedFeed.title);
      finishAndClose();
    } catch (error) {
      logger.warn('AddFeedModal', 'Adding feed failed', { url: feedUrl, error });
      setPreview({ kind: 'error', url, message: describeLinkError(error) });
      setBusy(null);
    }
  };

  const runOpmlImport = async (opmlText: string, source: { fileName?: string; url?: string }) => {
    const importResult = await importOpmlTextIntoLibrary(opmlText, {
      refreshTotalFeeds,
      notifyFeedLibraryChanged,
      ...source,
    });
    await navigateAfterOpmlImport(importResult, { selectFeed, selectTag });
    appToastService.show(formatOpmlImportSummary(importResult.summary));
  };

  const importPreviewedList = async (listPreview: Extract<LinkPreview, { kind: 'opml' }>) => {
    setBusy('importing');
    try {
      await runOpmlImport(listPreview.opmlText, { url: listPreview.url });
      setBusy(null);
      finishAndClose();
    } catch (error) {
      logger.warn('AddFeedModal', 'Feed list import from link failed', { url: listPreview.url, error });
      setPreview({ kind: 'error', url: listPreview.url, message: describeFileImportError(error) });
      setBusy(null);
    }
  };

  const showExistingFeed = (existing: Extract<LinkPreview, { kind: 'existing' }>) => {
    const { feed } = existing;
    onFeedAdded(feed.id, feed.url, feed.title);
    finishAndClose();
  };

  const primaryAction = (): { label: string; disabled: boolean; run?: () => void } => {
    if (busy === 'adding') return { label: 'Adding…', disabled: true };
    if (busy === 'importing') return { label: 'Importing…', disabled: true };

    switch (preview.kind) {
      case 'feed':
        return { label: 'Add feed', disabled: false, run: () => void addPreviewedFeed(preview) };
      case 'existing':
        return { label: 'Show feed', disabled: false, run: () => showExistingFeed(preview) };
      case 'opml':
        return preview.feedCount > 0
          ? {
            label: `Import ${pluralize(preview.feedCount, 'feed')}`,
            disabled: false,
            run: () => void importPreviewedList(preview),
          }
          : { label: 'Import', disabled: true };
      case 'error':
        return normalizedLink
          ? { label: 'Try again', disabled: false, run: () => void lookUpLink(normalizedLink) }
          : { label: 'Add feed', disabled: true };
      default:
        return { label: 'Add feed', disabled: true };
    }
  };

  const primary = primaryAction();
  // Only act on a preview that matches what is in the box right now.
  const previewMatchesInput = preview.kind === 'idle' || preview.url === normalizedLink;

  const handleLinkKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || isBusy) return;
    event.preventDefault();
    if (previewMatchesInput && primary.run && preview.kind !== 'error') {
      primary.run();
      return;
    }
    if (normalizedLink) {
      void lookUpLink(normalizedLink);
    }
  };

  const handleChooseOpmlFile = async () => {
    setFileError(null);
    setBusy('importing');
    try {
      const selectedFile = await openOpmlFileForImport();
      if (!selectedFile) {
        setBusy(null);
        return;
      }
      await runOpmlImport(selectedFile.opmlText, { fileName: selectedFile.fileName });
      setBusy(null);
      finishAndClose();
    } catch (error) {
      logger.warn('AddFeedModal', 'Feed list file import failed', { error });
      setFileError(describeFileImportError(error));
      setBusy(null);
    }
  };

  const handleSavedFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // Saved-article imports can take a while (CSV links are fetched one by
    // one); the service reports progress and the result in the sidebar.
    finishAndClose();
    void savedArticlesIOService.importSavedArticles(file).catch((error) => {
      logger.error('AddFeedModal', 'Saved articles import failed', { error });
    });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex].id;
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const renderPreview = () => {
    if (!previewMatchesInput || preview.kind === 'idle') {
      return (
        <p className="add-feed-hint" id={`${baseId}-hint`}>
          Paste a website or feed link, or a link to a feed list (.opml) to add many at once.
        </p>
      );
    }

    if (preview.kind === 'checking') {
      return (
        <div className="add-feed-status" role="status">
          <Spinner />
          <span>Looking for a feed at {hostLabel(preview.url)}…</span>
        </div>
      );
    }

    if (preview.kind === 'error') {
      return (
        <div className="add-feed-status add-feed-status-error" role="alert">
          <ErrorOutlineRoundedIcon className="add-feed-status-icon" aria-hidden="true" />
          <span>{preview.message}</span>
        </div>
      );
    }

    if (preview.kind === 'choices') {
      const { url, candidates } = preview;
      return (
        <div className="add-feed-choices">
          <p className="add-feed-choices-intro">
            {hostLabel(url)} has {pluralize(candidates.length, 'feed')}. Choose one to preview.
          </p>
          <ul className="add-feed-choice-list" aria-label="Feeds on this page">
            {candidates.map((candidate) => (
              <li key={candidate.url}>
                <button
                  type="button"
                  className="add-feed-choice"
                  onClick={() => void chooseFeed(url, candidate, candidates)}
                  disabled={isBusy}
                >
                  <span className="add-feed-choice-icon" aria-hidden="true"><FeedGlyph /></span>
                  <span className="add-feed-choice-text">
                    <span className="add-feed-choice-title">{candidate.title || hostLabel(candidate.url)}</span>
                    <span className="add-feed-choice-meta">
                      {feedTypeLabel(candidate.type)}
                      {' · '}
                      {hostLabel(candidate.url)}
                    </span>
                  </span>
                  <ChevronGlyph />
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (preview.kind === 'existing') {
      return (
        <div className="add-feed-preview" role="status">
          <div className="add-feed-preview-avatar" aria-hidden="true">
            <CheckCircleRoundedIcon />
          </div>
          <div className="add-feed-preview-text">
            <div className="add-feed-preview-title">{preview.feed.title}</div>
            <div className="add-feed-preview-meta">
              {formatExistingSubscriptionMessage(preview.feed.tags)}
            </div>
          </div>
        </div>
      );
    }

    if (preview.kind === 'opml') {
      return (
        <div className="add-feed-preview" role="status">
          <div className="add-feed-preview-avatar" aria-hidden="true">
            <ListAltRoundedIcon />
          </div>
          <div className="add-feed-preview-text">
            <div className="add-feed-preview-title">Feed list from {hostLabel(preview.url)}</div>
            <div className="add-feed-preview-meta">
              {preview.feedCount > 0
                ? `${pluralize(preview.feedCount, 'feed')} ready to import. Folders become stations.`
                : 'This list has no feeds in it.'}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="add-feed-preview" role="status">
        <div className="add-feed-preview-avatar" aria-hidden="true">
          {faviconPreview
            ? <img src={faviconPreview} alt="" className="add-feed-preview-favicon" />
            : <RssFeedRoundedIcon />}
        </div>
        <div className="add-feed-preview-text">
          <div className="add-feed-preview-title">{preview.title || hostLabel(preview.feedUrl)}</div>
          <div className="add-feed-preview-meta">
            {hostLabel(preview.feedUrl)}
            {' · '}
            {preview.itemCount > 0 ? pluralize(preview.itemCount, 'article') : 'No articles yet'}
          </div>
          {preview.recentTitles.length > 0 && (
            <ul className="add-feed-preview-items" aria-label="Latest articles">
              {preview.recentTitles.map((title, index) => (
                <li key={`${index}-${title}`}>{title}</li>
              ))}
            </ul>
          )}
          {preview.choices && (
            <button
              type="button"
              className="add-feed-link-button"
              onClick={() => showChoicesAgain(preview)}
              disabled={isBusy}
            >
              Other feeds on this page
            </button>
          )}
        </div>
      </div>
    );
  };

  const linkPanel = (
    <div className="add-feed-panel">
      <label className="add-feed-label" htmlFor={`${baseId}-link`}>Feed or website link</label>
      <div className="add-feed-input-wrap">
        <LinkRoundedIcon className="add-feed-input-icon" aria-hidden="true" />
        <input
          id={`${baseId}-link`}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="modal-input add-feed-input"
          placeholder="example.com"
          aria-describedby={`${baseId}-hint`}
          value={linkInput}
          onChange={(event) => {
            setLinkInput(event.target.value);
            if (normalizeLinkInput(event.target.value) !== normalizedLink) {
              resetLink();
            }
          }}
          onKeyDown={handleLinkKeyDown}
          disabled={isBusy}
          autoFocus
        />
      </div>
      <div className="add-feed-preview-slot" aria-live="polite">
        {renderPreview()}
      </div>
    </div>
  );

  const filePanel = (
    <div className="add-feed-panel">
      <div className="add-feed-options">
        <button
          type="button"
          className="add-feed-option"
          onClick={() => void handleChooseOpmlFile()}
          disabled={isBusy}
        >
          <span className="add-feed-option-icon" aria-hidden="true">
            {busy === 'importing' ? <Spinner /> : <ListAltRoundedIcon />}
          </span>
          <span className="add-feed-option-text">
            <span className="add-feed-option-title">
              {busy === 'importing' ? 'Importing your feeds…' : 'Feed list'}
            </span>
            <span className="add-feed-option-meta">
              Move your subscriptions from another reader (.opml). Folders become stations.
            </span>
          </span>
          <ChevronRightRoundedIcon className="add-feed-option-chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="add-feed-option"
          onClick={() => savedFileInputRef.current?.click()}
          disabled={isBusy}
        >
          <span className="add-feed-option-icon" aria-hidden="true">
            <BookmarksRoundedIcon />
          </span>
          <span className="add-feed-option-text">
            <span className="add-feed-option-title">Saved articles</span>
            <span className="add-feed-option-meta">
              A saved-articles export (.zip) or a list of links (.csv).
            </span>
          </span>
          <ChevronRightRoundedIcon className="add-feed-option-chevron" aria-hidden="true" />
        </button>
        <input
          ref={savedFileInputRef}
          type="file"
          accept=".zip,.csv"
          className="add-feed-hidden-input"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="add-feed-saved-file-input"
          onChange={handleSavedFileChange}
        />
      </div>
      {fileError && (
        <div className="add-feed-status add-feed-status-error" role="alert">
          <ErrorOutlineRoundedIcon className="add-feed-status-icon" aria-hidden="true" />
          <span>{fileError}</span>
        </div>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="460px"
      closeOnBackdrop={!isBusy}
      closeOnEscape={!isBusy}
      ariaLabelledBy={`${baseId}-title`}
    >
      <div className="add-feed-modal-body" aria-busy={isBusy}>
        <h2 className="add-feed-modal-title" id={`${baseId}-title`}>Add Feeds</h2>

        <div className="add-feed-tabs" role="tablist" aria-label="How to add">
          {TABS.map((tab) => {
            const selected = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                ref={(node) => { tabRefs.current[tab.id] = node; }}
                id={`${baseId}-tab-${tab.id}`}
                type="button"
                role="tab"
                className="add-feed-tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                disabled={isBusy && !selected}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={handleTabKeyDown}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {TABS.map((tab) => (
          <div
            key={tab.id}
            id={`${baseId}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={tab.id !== activeTab}
          >
            {tab.id === activeTab && (tab.id === 'link' ? linkPanel : filePanel)}
          </div>
        ))}

        <div className="add-feed-actions">
          <button
            type="button"
            className="modal-confirm-button modal-confirm-button-outline add-feed-action"
            onClick={handleClose}
            disabled={isBusy}
          >
            Cancel
          </button>
          {activeTab === 'link' && (
            <button
              type="button"
              className="modal-confirm-button add-feed-action"
              onClick={primary.run}
              disabled={primary.disabled || !primary.run || !previewMatchesInput}
            >
              {isBusy && <Spinner />}
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
