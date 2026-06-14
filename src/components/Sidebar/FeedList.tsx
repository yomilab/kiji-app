import React, { useCallback, useEffect, useMemo, useState } from 'react';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { feedsManager } from '@/services/feeds/feedsManager';
import { articlesManager } from '@/services/articles/articlesManager';
import {
  useFeedDeletedMutation,
  useFeedPatchedMutation,
  useFeedsAddedMutation,
  useFeedsCountsUpdatedMutation,
  useStationDeletedMutation,
} from '@/hooks/useFeedLibraryMutation';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { AddFeedModal } from './AddFeedModal';
import { TagEditModal } from './TagEditModal';
import { useFeedFaviconRefreshed, useFeedNavigation, useFeedUIActions } from '@/contexts/FeedContext';
import { ButtonStack, type ButtonConfig } from '@/components/common/ButtonStack';
import { Modal } from '@/components/common/Modal';
import { FaviconImage } from '@/components/common/FaviconImage';
import './FeedList.css';

interface Feed {
  id: string;
  title: string;
  url: string;
  unreadCount?: number;
  articleCount?: number;
  tags: string[];
  favicon?: string;
  faviconHasTransparency?: boolean;
  faviconBgLight?: string;
  faviconBgDark?: string;
  emoji?: string;
  sortOrder?: number;
}

interface FeedListProps {
  showAddModal: boolean;
  onCloseAddModal: () => void;
}

interface FeedListItemProps {
  feed: Feed;
  isSelected: boolean;
  onSelectFeed: (feed: Feed) => Promise<void>;
  onOpenFeedEdit: (feedId: string) => void;
}

const FeedListItem = React.memo<FeedListItemProps>(({
  feed,
  isSelected,
  onSelectFeed,
  onOpenFeedEdit,
}) => {
  const buttons = useMemo<ButtonConfig[]>(() => [
    {
      id: 'edit',
      icon: EditOutlined,
      label: 'Edit feed',
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        onOpenFeedEdit(feed.id);
      },
    },
  ], [feed.id, onOpenFeedEdit]);

  return (
    <li
      className={`feed-list-item ${isSelected ? 'feed-list-item-selected' : ''}`}
      onClick={() => { void onSelectFeed(feed); }}
      data-section="unstationed-feed-item"
      data-component="feed-item"
      data-action="select-feed"
      data-entity-id={feed.id}
    >
      <div className="feed-list-item-content">
        <div className="feed-list-item-favicon-wrapper">
          <FaviconImage
            localFavicon={feed.favicon}
            hasTransparency={feed.faviconHasTransparency}
            emoji={feed.emoji}
            alt={feed.title}
            itemId={feed.id}
          />
        </div>
        <span className="feed-list-item-title" data-section="unstationed-feed-name" data-component="feed-name">
          <span className="feed-list-item-title-text">{feed.title}</span>
        </span>
      </div>
      <ButtonStack
        buttons={buttons}
        direction="left"
        layoutMode="push"
        className="feed-list-item-buttons"
        data-component="feed-item-actions"
      />
    </li>
  );
});

export const FeedList: React.FC<FeedListProps> = ({ showAddModal, onCloseAddModal }) => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [tagEditFeedId, setTagEditFeedId] = useState<string | null>(null);
  const [feedToDelete, setFeedToDelete] = useState<{ id: string; title: string } | null>(null);
  const { selectedFeedId, selectFeed, clearFeedSelection, openFeedEditView } = useFeedNavigation();
  const { refreshTotalFeeds } = useFeedUIActions();
  const feedFaviconRefreshed = useFeedFaviconRefreshed();
  const patchedFeed = useFeedPatchedMutation();
  const deletedFeed = useFeedDeletedMutation();
  const addedFeeds = useFeedsAddedMutation();
  const feedsCountsUpdated = useFeedsCountsUpdatedMutation();
  const deletedStation = useStationDeletedMutation();

  const sortUntaggedFeeds = useCallback((feedList: Feed[]) => (
    [...feedList].sort((a, b) => {
      const sortOrderDiff = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (sortOrderDiff !== 0) {
        return sortOrderDiff;
      }

      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    })
  ), []);

  const loadFeeds = useCallback(async () => {
    const feedList = await feedsManager.getAllFeeds();
    const untaggedFeeds = sortUntaggedFeeds(
      feedList.filter(feed => !feed.tags || feed.tags.length === 0)
    );
    setFeeds(untaggedFeeds);
  }, [sortUntaggedFeeds]);

  const handleFeedSelect = useCallback(async (feed: Feed) => {
    await selectFeed(feed.id, feed.url, feed.title, { forceNetwork: true });
  }, [selectFeed]);

  const handleOpenFeedEdit = useCallback((feedId: string) => {
    openFeedEditView({ kind: 'feed', id: feedId });
  }, [openFeedEditView]);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    if (!feedFaviconRefreshed) return;
    const { feedId } = feedFaviconRefreshed;
    feedsManager.getFeedById(feedId).then((updated) => {
      if (!updated) return;
      setFeeds((prev) =>
        prev.map((f) => f.id === feedId ? { ...f, favicon: updated.favicon, faviconHasTransparency: updated.faviconHasTransparency, faviconBgLight: updated.faviconBgLight, faviconBgDark: updated.faviconBgDark } : f)
      );
    });
  }, [feedFaviconRefreshed]);

  useEffect(() => {
    if (!patchedFeed) return;
    const nextTags = patchedFeed.changes.tags;

    setFeeds((current) => {
      const currentIndex = current.findIndex((feed) => feed.id === patchedFeed.feedId);
      if (currentIndex < 0) {
        return current;
      }

      const nextFeeds = [...current];
      const patchedEntry = {
        ...nextFeeds[currentIndex],
        ...patchedFeed.changes,
      };

      if (nextTags && nextTags.length > 0) {
        nextFeeds.splice(currentIndex, 1);
        return nextFeeds;
      }

      nextFeeds[currentIndex] = patchedEntry;
      return sortUntaggedFeeds(nextFeeds);
    });

    if (nextTags && nextTags.length === 0) {
      void feedsManager.getFeedById(patchedFeed.feedId).then((feed) => {
        if (!feed || (feed.tags && feed.tags.length > 0)) return;

        setFeeds((current) => {
          if (current.some((entry) => entry.id === feed.id)) return current;
          return sortUntaggedFeeds([
            ...current,
            {
              id: feed.id,
              title: feed.title,
              url: feed.url,
              unreadCount: feed.unreadCount,
              tags: feed.tags,
              favicon: feed.favicon,
              faviconHasTransparency: feed.faviconHasTransparency,
              faviconBgLight: feed.faviconBgLight,
              faviconBgDark: feed.faviconBgDark,
              emoji: feed.emoji,
              sortOrder: feed.sortOrder,
            },
          ]);
        });
      });
    }
  }, [patchedFeed, sortUntaggedFeeds]);

  useEffect(() => {
    if (!feedsCountsUpdated) return;

    setFeeds((current) => {
      let changed = false;
      const nextFeeds = [...current];
      for (const feedCounts of feedsCountsUpdated.feeds) {
        const index = nextFeeds.findIndex((feed) => feed.id === feedCounts.id);
        if (index < 0) {
          continue;
        }
        changed = true;
        nextFeeds[index] = {
          ...nextFeeds[index],
          unreadCount: feedCounts.unreadCount,
          articleCount: feedCounts.articleCount,
        };
      }
      return changed ? nextFeeds : current;
    });
  }, [feedsCountsUpdated]);

  useEffect(() => {
    if (!deletedFeed) return;

    setFeeds((current) => current.filter((feed) => feed.id !== deletedFeed.feedId));
  }, [deletedFeed]);

  useEffect(() => {
    if (!deletedStation || deletedStation.affectedFeedIds.length === 0) return;

    void Promise.all(
      deletedStation.affectedFeedIds.map((feedId) => feedsManager.getFeedById(feedId))
    ).then((candidateFeeds) => {
      const untaggedFeeds = candidateFeeds.filter((feed): feed is Feed => (
        feed !== null && (!feed.tags || feed.tags.length === 0)
      ));
      if (untaggedFeeds.length === 0) {
        return;
      }

      setFeeds((current) => {
        const existingIds = new Set(current.map((feed) => feed.id));
        const missingFeeds = untaggedFeeds.filter((feed) => !existingIds.has(feed.id));
        if (missingFeeds.length === 0) {
          return current;
        }

        return sortUntaggedFeeds([...current, ...missingFeeds]);
      });
    });
  }, [deletedStation, sortUntaggedFeeds]);

  useEffect(() => {
    if (!addedFeeds) return;

    setFeeds((current) => {
      const existingIds = new Set(current.map((feed) => feed.id));
      const nextFeeds = addedFeeds.feeds.filter((feed) => (
        (!feed.tags || feed.tags.length === 0) && !existingIds.has(feed.id)
      ));
      if (nextFeeds.length === 0) {
        return current;
      }

      return sortUntaggedFeeds([...current, ...nextFeeds]);
    });
  }, [addedFeeds, sortUntaggedFeeds]);

  const handleFeedAdded = async (feedId: string, feedUrl: string, feedTitle: string) => {
    const addedFeed = await feedsManager.getFeedById(feedId);
    if (addedFeed) {
      feedLibraryMutationBus.publishFeedsAdded([addedFeed]);
    }
    await refreshTotalFeeds();
    // Auto-select the newly added feed
    await selectFeed(feedId, feedUrl, feedTitle, { forceNetwork: true });
  };

  const handleDeleteFeed = async () => {
    if (!feedToDelete) return;

    try {
      // Check if we're deleting the currently selected feed
      const isDeletingSelectedFeed = selectedFeedId === feedToDelete.id;

      // Delete articles for this feed (preserves saved articles)
      await articlesManager.deleteArticlesByFeed(feedToDelete.id);

      // Delete the feed itself
      await feedsManager.deleteFeed(feedToDelete.id);

      // If we deleted the currently selected feed, clear the selection
      if (isDeletingSelectedFeed) {
        clearFeedSelection();
      }

      feedLibraryMutationBus.publishFeedDeleted(feedToDelete.id);
      await refreshTotalFeeds();

      // Close confirmation dialog
      setFeedToDelete(null);
    } catch (error) {
      console.error('Error deleting feed:', error);
      // TODO: Show error toast to user
    }
  };

  const handleCancelDelete = () => {
    setFeedToDelete(null);
  };

  return (
    <>
      <div className="feed-list-container">
        {feeds.length > 0 && (
            <ul className="feed-list" data-section="unstationed-feeds-group">
              {feeds.map((feed) => (
                <FeedListItem
                  key={feed.id}
                  feed={feed}
                  isSelected={selectedFeedId === feed.id}
                  onSelectFeed={handleFeedSelect}
                  onOpenFeedEdit={handleOpenFeedEdit}
                />
              ))}
            </ul>
          )}
      </div>

      <AddFeedModal
        isOpen={showAddModal}
        onClose={onCloseAddModal}
        onFeedAdded={handleFeedAdded}
      />

      {tagEditFeedId && (
        <TagEditModal
          feedId={tagEditFeedId}
          onClose={() => setTagEditFeedId(null)}
          onTagsChanged={() => {
            setTagEditFeedId(null);
          }}
        />
      )}

      <Modal
        isOpen={!!feedToDelete}
        onClose={handleCancelDelete}
        maxWidth="450px"
        closeOnBackdrop={true}
        closeOnEscape={true}
      >
        <div className="feed-delete-modal-body">
          <h2 className="add-feed-modal-title">Delete Feed</h2>
          <p className="feed-delete-modal-description">
            Are you sure you want to delete "{feedToDelete?.title}"?
          </p>
          <p className="feed-delete-modal-description feed-delete-modal-warning">
            All articles will be removed, except saved articles which will be preserved.
          </p>
          <button
            className="modal-confirm-button modal-confirm-button-danger feed-delete-modal-confirm"
            onClick={handleDeleteFeed}
            type="button"
          >
            Delete Feed
          </button>
        </div>
      </Modal>
    </>
  );
};
