import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import EditOutlined from '@mui/icons-material/EditOutlined';
import UnfoldMoreOutlined from '@mui/icons-material/UnfoldMoreOutlined';
import UnfoldLessOutlined from '@mui/icons-material/UnfoldLessOutlined';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import { seedArticleFeedMetadataFromFeed } from '@/services/articles/articleListMemory';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import {
  useFeedDeletedMutation,
  useFeedPatchedMutation,
  useFeedsCountsUpdatedMutation,
  useStationDeletedMutation,
  useStationPatchedMutation,
  useStationsHydratedMutation,
  useStationsReorderedMutation,
} from '@/hooks/useFeedLibraryMutation';
import { useFeedFaviconRefreshed, useFeedNavigation, type FeedEditTarget } from '@/contexts/FeedContext';
import { ButtonStack, type ButtonConfig } from '@/components/common/ButtonStack';
import { FaviconImage } from '@/components/common/FaviconImage';
import type { Tag } from '@/types/tag';
import './TagManager.css';

interface StationFeedItemProps {
  feed: Feed;
  isSelected: boolean;
  onSelectFeed: (feed: Feed) => Promise<void>;
  onOpenFeedEditView: (target: FeedEditTarget) => void;
}

const StationFeedItem = React.memo<StationFeedItemProps>(({
  feed,
  isSelected,
  onSelectFeed,
  onOpenFeedEditView,
}) => {
  const buttons = useMemo<ButtonConfig[]>(() => [
    {
        id: 'edit',
        icon: EditOutlined,
        label: 'Edit feed',
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onOpenFeedEditView({ kind: 'feed', id: feed.id });
        },
      },
  ], [feed.id, onOpenFeedEditView]);

  return (
    <li
      className={`station-feed-item ${isSelected ? 'station-feed-item-selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        void onSelectFeed(feed);
      }}
      data-section="station-feed-item"
      data-component="feed-item"
      data-action="select-feed"
      data-entity-id={feed.id}
    >
      <div className="station-feed-item-content">
        <div className="station-feed-item-favicon-wrapper">
          <FaviconImage
            localFavicon={feed.favicon}
            hasTransparency={feed.faviconHasTransparency}
            emoji={feed.emoji}
            alt={feed.title}
            itemId={feed.id}
          />
        </div>
        <span className="station-feed-item-title">
          <span className="station-feed-item-title-text">{feed.title}</span>
        </span>
      </div>
      <ButtonStack
        buttons={buttons}
        direction="left"
        layoutMode="push"
        className="station-feed-item-buttons"
      />
    </li>
  );
});

interface StationListItemProps {
  tag: Tag;
  isExpanded: boolean;
  isSelected: boolean;
  stationFeeds: Feed[];
  onToggleStation: (tagName: string) => void;
  onTagClick: (tagName: string) => void;
  onOpenFeedEditView: (target: FeedEditTarget) => void;
  onSelectFeed: (feed: Feed) => Promise<void>;
  selectedFeedId: string | null;
}

const StationListItem = React.memo<StationListItemProps>(({
  tag,
  isExpanded,
  isSelected,
  stationFeeds,
  onToggleStation,
  onTagClick,
  onOpenFeedEditView,
  onSelectFeed,
  selectedFeedId,
}) => {
  const stationButtons = useMemo<ButtonConfig[]>(() => [
    {
      id: 'toggle',
      icon: isExpanded ? UnfoldLessOutlined : UnfoldMoreOutlined,
      label: isExpanded ? 'Collapse station' : 'Expand station',
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation();
        onToggleStation(tag.name);
      },
    },
    {
        id: 'edit',
        icon: EditOutlined,
        label: 'Edit station',
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          onOpenFeedEditView({ kind: 'station', id: tag.name });
        },
      },
  ], [isExpanded, tag.name, onToggleStation, onOpenFeedEditView]);

  return (
    <li className="tag-item-wrapper">
      <div
        className={`tag-item ${isSelected ? 'is-selected' : ''}`}
        onClick={() => onTagClick(tag.name)}
        data-section="station-item"
        data-component="station-item"
        data-action="select-station"
        data-entity-id={tag.name}
        data-station-name={tag.name}
      >
        <div className="tag-item-content">
          {tag.emoji ? (
            <span className="tag-item-emoji">{tag.emoji}</span>
          ) : (
            <span className="tag-item-icon" aria-hidden="true" />
          )}
          <span className="tag-name" data-section="station-name">
            <span className="tag-name-text">{tag.name}</span>
          </span>
        </div>
        <ButtonStack
          buttons={stationButtons}
          direction="left"
          layoutMode="push"
          className="tag-item-buttons"
        />
      </div>
      <AnimatePresence>
        {isExpanded && stationFeeds.length > 0 && (
          <motion.ul
            className="station-feeds-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {stationFeeds.map((feed) => (
              <StationFeedItem
                key={feed.id}
                feed={feed}
                isSelected={selectedFeedId === feed.id}
                onSelectFeed={onSelectFeed}
                onOpenFeedEditView={onOpenFeedEditView}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
});

const TAG_MANAGER_FEED_CACHE_MAX_ENTRIES = 200;

const rememberFeedInCache = (prev: Map<string, Feed>, feed: Feed): Map<string, Feed> => {
  const next = new Map(prev);
  next.delete(feed.id);
  next.set(feed.id, feed);
  seedArticleFeedMetadataFromFeed(feed);

  while (next.size > TAG_MANAGER_FEED_CACHE_MAX_ENTRIES) {
    const oldestKey = next.keys().next().value;
    if (!oldestKey) {
      break;
    }
    next.delete(oldestKey);
  }

  return next;
};

export const TagManager: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());
  const [feedCache, setFeedCache] = useState<Map<string, Feed>>(new Map());
  const feedCacheRef = useRef(feedCache);
  const { selectedTag, selectTag, selectedFeedId, selectFeed, openFeedEditView, clearFeedSelection } = useFeedNavigation();
  const feedFaviconRefreshed = useFeedFaviconRefreshed();
  const patchedFeed = useFeedPatchedMutation();
  const feedsCountsUpdated = useFeedsCountsUpdatedMutation();
  const deletedFeed = useFeedDeletedMutation();
  const patchedStation = useStationPatchedMutation();
  const deletedStation = useStationDeletedMutation();
  const hydratedStations = useStationsHydratedMutation();
  const stationsReordered = useStationsReorderedMutation();

  useEffect(() => {
    feedCacheRef.current = feedCache;
  }, [feedCache]);

  const ensureFeedsCached = useCallback(async (feedIds: string[]) => {
    const missing = feedIds.filter(id => !feedCacheRef.current.has(id));
    if (missing.length > 0) {
      const fetched = await Promise.all(missing.map(id => feedsManager.getFeedById(id)));
      setFeedCache((prev) => {
        let next = prev;
        for (const feed of fetched) {
          if (feed) {
            next = rememberFeedInCache(next, feed);
          }
        }
        feedCacheRef.current = next;
        return next;
      });
    }

    opmlWorkflowService.scheduleMissingFaviconsAfterStationSelection(feedIds);
  }, []);

  const toggleStation = useCallback((tagName: string) => {
    setExpandedStations(prev => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
        const tag = tags.find(t => t.name === tagName);
        if (tag) void ensureFeedsCached(tag.feedIds);
      }
      return next;
    });
  }, [ensureFeedsCached, tags]);

  const handleStationFeedClick = useCallback(async (feed: Feed) => {
    await selectFeed(feed.id, feed.url, feed.title);
  }, [selectFeed]);

  const loadTags = useCallback(async () => {
    try {
      const allTags = await tagsManager.getAllTags();
      setTags(allTags);
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  }, []);

  const handleTagClick = useCallback(async (tagName: string) => {
    try {
      await selectTag(tagName);
    } catch (error) {
      console.error('Error selecting tag:', error);
    }
  }, [selectTag]);

  const handleOpenFeedEditView = useCallback((target: FeedEditTarget) => {
    openFeedEditView(target);
  }, [openFeedEditView]);

  useEffect(() => {
    void loadTags();
    setFeedCache(new Map());
  }, [loadTags]);

  useEffect(() => {
    if (!feedFaviconRefreshed) return;
    const { feedId } = feedFaviconRefreshed;
    feedsManager.getFeedById(feedId).then((updated) => {
      if (!updated) return;
      setFeedCache((prev) => {
        if (!prev.has(feedId)) return prev;
        return rememberFeedInCache(prev, updated);
      });
    });
  }, [feedFaviconRefreshed]);

  useEffect(() => {
    if (!patchedFeed) return;
    setFeedCache((prev) => {
      const current = prev.get(patchedFeed.feedId);
      if (!current) {
        return prev;
      }

      return rememberFeedInCache(prev, {
        ...current,
        ...patchedFeed.changes,
      });
    });
  }, [patchedFeed]);

  useEffect(() => {
    if (!feedsCountsUpdated) return;
    setFeedCache((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const feedCounts of feedsCountsUpdated.feeds) {
        const current = next.get(feedCounts.id);
        if (!current) {
          continue;
        }
        changed = true;
        next.set(feedCounts.id, {
          ...current,
          unreadCount: feedCounts.unreadCount,
          articleCount: feedCounts.articleCount,
        });
      }
      return changed ? next : prev;
    });
  }, [feedsCountsUpdated]);

  useEffect(() => {
    if (!deletedFeed) return;

    setFeedCache((prev) => {
      if (!prev.has(deletedFeed.feedId)) {
        return prev;
      }

      const next = new Map(prev);
      next.delete(deletedFeed.feedId);
      return next;
    });

    setTags((prev) => prev.map((tag) => {
      if (!tag.feedIds.includes(deletedFeed.feedId)) {
        return tag;
      }

      return {
        ...tag,
        feedIds: tag.feedIds.filter((feedId) => feedId !== deletedFeed.feedId),
      };
    }));
  }, [deletedFeed]);

  useEffect(() => {
    if (!patchedStation) return;

    setTags((prev) => {
      let hasPatchedStation = false;
      const nextTags = prev.map((tag) => {
        if (tag.name !== patchedStation.previousName) {
          return tag;
        }

        hasPatchedStation = true;
        return {
          ...tag,
          ...patchedStation.station,
        };
      });

      if (hasPatchedStation) {
        return nextTags;
      }

      return [...prev, {
        ...patchedStation.station,
        color: undefined,
      }].sort((left, right) => {
        const sortOrderDiff = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
        if (sortOrderDiff !== 0) {
          return sortOrderDiff;
        }

        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
    });

    setExpandedStations((prev) => {
      if (
        patchedStation.previousName === patchedStation.station.name
        || !prev.has(patchedStation.previousName)
      ) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(patchedStation.previousName);
      next.add(patchedStation.station.name);
      return next;
    });

    if (expandedStations.has(patchedStation.station.name)) {
      void ensureFeedsCached(patchedStation.station.feedIds);
    }
  }, [ensureFeedsCached, expandedStations, patchedStation]);

  useEffect(() => {
    if (!deletedStation) return;

    setTags((prev) => prev.filter((tag) => tag.name !== deletedStation.stationName));
    if (selectedTag === deletedStation.stationName) {
      clearFeedSelection();
    }
    setExpandedStations((prev) => {
      if (!prev.has(deletedStation.stationName)) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(deletedStation.stationName);
      return next;
    });
  }, [clearFeedSelection, deletedStation, selectedTag]);

  useEffect(() => {
    if (!hydratedStations) return;

    // Replace the station list from a full snapshot after bulk imports so the
    // sidebar cannot miss intermediate station events that were emitted faster
    // than React could observe them.
    setTags(hydratedStations.stations);
  }, [hydratedStations]);

  useEffect(() => {
    if (!stationsReordered) return;

    // Preserve station object identities so sidebar rows that did not move can
    // stay memoized when feed management updates only the ordering.
    setTags((prev) => {
      const nextOrderByName = new Map(
        stationsReordered.stations.map((station, index) => [station.name, station.sortOrder ?? index])
      );
      const nextTags = [...prev].sort((left, right) => (
        (nextOrderByName.get(left.name) ?? Number.MAX_SAFE_INTEGER)
        - (nextOrderByName.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      ));

      const hasOrderChanged = nextTags.some((tag, index) => tag !== prev[index]);
      return hasOrderChanged ? nextTags : prev;
    });
  }, [stationsReordered]);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="tag-manager" data-section="stations">
      <ul className="tag-list" data-section="stations-group">
        {tags.map((tag) => {
          const isExpanded = expandedStations.has(tag.name);
          const stationFeeds = isExpanded
            ? tag.feedIds
              .map(id => feedCache.get(id))
              .filter((f): f is Feed => !!f)
              .sort((a, b) => {
                const sortOrderDiff = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
                if (sortOrderDiff !== 0) {
                  return sortOrderDiff;
                }

                return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
              })
            : [];
          return (
            <StationListItem
              key={tag.name}
              tag={tag}
              isExpanded={isExpanded}
              isSelected={selectedTag === tag.name}
              stationFeeds={stationFeeds}
              onToggleStation={toggleStation}
              onTagClick={handleTagClick}
              onOpenFeedEditView={handleOpenFeedEditView}
              onSelectFeed={handleStationFeedClick}
              selectedFeedId={selectedFeedId}
            />
          );
        })}
      </ul>
    </div>
  );
};
