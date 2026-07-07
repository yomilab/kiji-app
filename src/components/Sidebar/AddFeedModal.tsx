import React, { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { useFeedUIActions } from '@/contexts/FeedContext';
import * as articleStore from '@/stores/articleStore';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import {
  formatOpmlImportSummary,
  importOpmlFromUrlIntoLibrary,
  importOpmlTextIntoLibrary,
  isLikelyOpmlUrl,
  navigateAfterOpmlImport,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { appToastService } from '@/services/ui/appToastService';
import { useFeedNavigation } from '@/contexts/FeedContext';
import './AddFeedModal.css';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFeedAdded: (feedId: string, feedUrl: string, feedTitle: string) => void;
}

export const AddFeedModal: React.FC<AddFeedModalProps> = ({
  isOpen,
  onClose,
  onFeedAdded,
}) => {
  const [feedUrl, setFeedUrl] = useState('');
  const [activeAction, setActiveAction] = useState<'adding' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshTotalFeeds, notifyFeedLibraryChanged } = useFeedUIActions();
  const { selectFeed, selectTag } = useFeedNavigation();
  const isLoading = activeAction !== null;

  const extractFeedTitleFromXml = (xmlText: string): string | null => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      return null;
    }

    const titleElement =
      xmlDoc.querySelector('channel > title') ||
      xmlDoc.querySelector('feed > title') ||
      xmlDoc.querySelector('title');

    return titleElement?.textContent?.trim() || null;
  };

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const formatExistingSubscriptionMessage = (stationNames: string[], feedTitle: string): string => {
    if (stationNames.length === 0) {
      return `Already subscribed to "${feedTitle}".`;
    }

    if (stationNames.length === 1) {
      return `Already subscribed to "${feedTitle}" in station "${stationNames[0]}".`;
    }

    return `Already subscribed to "${feedTitle}" in stations "${stationNames.join('", "')}".`;
  };

  const trimmedInput = feedUrl.trim();
  const isOpmlInput = isLikelyOpmlUrl(trimmedInput);

  const applyOpmlImport = async (opmlText: string, fileName?: string) => {
    const importResult = await importOpmlTextIntoLibrary(opmlText, {
      refreshTotalFeeds,
      notifyFeedLibraryChanged,
      fileName,
    });
    await navigateAfterOpmlImport(importResult, { selectFeed, selectTag });
    appToastService.show(formatOpmlImportSummary(importResult.summary));
    setFeedUrl('');
    setError(null);
    onClose();
  };

  const handleAddFeed = async () => {
    setError(null);
    const trimmedFeedUrl = feedUrl.trim();

    // Validate URL format
    if (!trimmedFeedUrl) {
      setError('Please enter a feed or OPML URL');
      return;
    }

    if (!validateUrl(trimmedFeedUrl)) {
      setError('Please enter a valid URL (http:// or https://)');
      return;
    }

    if (isLikelyOpmlUrl(trimmedFeedUrl)) {
      setActiveAction('importing');

      try {
        const importResult = await importOpmlFromUrlIntoLibrary(trimmedFeedUrl, {
          refreshTotalFeeds,
          notifyFeedLibraryChanged,
        });
        await navigateAfterOpmlImport(importResult, { selectFeed, selectTag });
        appToastService.show(formatOpmlImportSummary(importResult.summary));
        setFeedUrl('');
        setError(null);
        onClose();
      } catch (importError) {
        const message = importError instanceof Error
          ? importError.message
          : 'Failed to import OPML file.';
        setError(message);
      } finally {
        setActiveAction(null);
      }

      return;
    }

    setActiveAction('adding');

    try {
      // Check if the feed URL already exists before we do anything else
      // If it does, we select it, close the modal, and show the shared toast.
      const existingFeed = await feedsManager.getFeedByUrl(trimmedFeedUrl);
      if (existingFeed) {
        setFeedUrl('');
        setError(null);
        // Clear the modal action state before selecting the existing feed so a
        // duplicate-subscription shortcut never reopens into a disabled modal.
        setActiveAction(null);
        appToastService.show(
          formatExistingSubscriptionMessage(existingFeed.tags, existingFeed.title)
        );
        onFeedAdded(existingFeed.id, existingFeed.url, existingFeed.title);
        onClose();
        return;
      }

      // Fetch once, validate parse, and reuse the same payload for initial article storage.
      const fetchResult = await feedsFetcher.fetchFeedWithCache(trimmedFeedUrl);
      if (fetchResult.notModified || !fetchResult.data) {
        throw new Error('Failed to load feed. Please check the URL and try again.');
      }

      const feedItems = fetchResult.items ?? [];
      const xmlText = fetchResult.data;

      // Pre-generate feed ID so we can use it for article conversion
      const feedId = feedsManager.generateId();

      if (feedItems.length === 0) {
        console.warn('Feed appears to be empty, but adding it anyway');
      }

      const feedTitle = extractFeedTitleFromXml(xmlText);

      // Fetch favicon asynchronously (non-blocking if it fails)
      let favicon: string | undefined;
      let faviconFetchFailed = false;
      try {
        favicon = (await faviconFetcher.fetchFavicon(trimmedFeedUrl, xmlText)) ?? undefined;
        if (favicon) {
          if (!favicon.startsWith('data:')) {
            console.error('[AddFeedModal] Invalid favicon format (not base64)');
            favicon = undefined;
            faviconFetchFailed = true;
          }
        } else {
          faviconFetchFailed = true;
        }
      } catch (error) {
        console.error('[AddFeedModal] Favicon fetch error:', error);
        faviconFetchFailed = true;
      }

      const addedFeed = await feedsManager.addFeed(
        trimmedFeedUrl,
        feedTitle || undefined,
        {
          id: feedId,
          skipMetadataFetch: true,
          skipFaviconRefresh: true,
        },
      );

      if (feedItems.length > 0) {
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
          articleCount: counts?.articleCount ?? feedItems.length,
          unreadCount: counts?.unreadCount ?? feedItems.length,
        });

        if (counts) {
          feedLibraryMutationBus.publishFeedsCountsUpdated([{
            feedId: addedFeed.id,
            unreadCount: counts.unreadCount,
            articleCount: counts.articleCount,
          }]);
        }
      }

      if (favicon || faviconFetchFailed) {
        await feedsManager.updateFeed(addedFeed.id, {
          favicon,
          faviconFetchFailed,
        });
      }

      // Reset form and close modal
      setFeedUrl('');
      setError(null);
      onFeedAdded(addedFeed.id, addedFeed.url, addedFeed.title);
      onClose();
    } catch (error) {
      console.error('Error adding feed:', error);

      // Use the error message from feedsFetcher (already user-friendly)
      let errorMessage = 'Failed to load feed. Please check the URL and try again.';

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      setError(errorMessage);
    } finally {
      setActiveAction(null);
    }
  };

  const handleImportFeeds = async () => {
    setError(null);
    setActiveAction('importing');

    try {
      const selectedFile = await openOpmlFileForImport();
      if (!selectedFile) {
        // Reset immediately on file-picker cancel so reopening the modal does
        // not depend on the surrounding async control flow to re-enable inputs.
        setActiveAction(null);
        return;
      }

      await applyOpmlImport(selectedFile.opmlText, selectedFile.fileName);
    } catch (importError) {
      appToastService.show(
        importError instanceof Error ? importError.message : 'Failed to import OPML file.'
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setFeedUrl('');
      setError(null);
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      handleAddFeed();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="480px"
      closeOnBackdrop={!isLoading}
      closeOnEscape={!isLoading}
    >
      <div className="add-feed-modal-body">
        <h2 className="add-feed-modal-title">Add Feed</h2>
        <p id="add-feed-modal-description" className="add-feed-modal-description">
          Paste a feed URL to subscribe to one source, or an OPML link ending in
          {' '}
          <code className="add-feed-modal-code">.opml</code>
          {' '}
          to import many feeds at once. You can also choose an OPML file below.
        </p>
        <div className="modal-input-row add-feed-modal-input-row">
          <input
            id="feed-url"
            type="url"
            className="add-feed-modal-input modal-input"
            placeholder="Paste a feed or OPML URL"
            aria-label="Feed URL or OPML link"
            aria-describedby="add-feed-modal-description"
            value={feedUrl}
            onChange={(e) => {
              setFeedUrl(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyPress}
            disabled={isLoading}
            autoFocus
          />
        </div>
        {error && <div className="add-feed-modal-error">{error}</div>}
        <div className="add-feed-modal-actions">
          <button
            className="modal-confirm-button add-feed-modal-button"
            onClick={handleAddFeed}
            disabled={isLoading || !feedUrl.trim()}
            type="button"
          >
            {activeAction === 'adding'
              ? 'Loading...'
              : activeAction === 'importing'
                ? 'Importing...'
                : isOpmlInput
                  ? 'Import Feeds'
                  : 'Add Feed'}
          </button>
          <button
            className="modal-confirm-button add-feed-modal-button"
            onClick={handleImportFeeds}
            disabled={isLoading}
            type="button"
          >
            {activeAction === 'importing' ? 'Importing...' : 'Choose OPML File'}
          </button>
          <button
            className="modal-confirm-button add-feed-modal-button"
            onClick={handleClose}
            disabled={isLoading}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
