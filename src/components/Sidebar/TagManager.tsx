import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EditOutlined from '@mui/icons-material/EditOutlined';
import UnfoldMoreOutlined from '@mui/icons-material/UnfoldMoreOutlined';
import UnfoldLessOutlined from '@mui/icons-material/UnfoldLessOutlined';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import {
  useFeedDeletedMutation,
  useFeedPatchedMutation,
  useFeedsCountsUpdatedMutation,
  useStationDeletedMutation,
  useStationPatchedMutation,
  useStationsHydratedMutation,
  useStationsReorderedMutation,
  useStationMembershipReorderedMutation,
} from '@/hooks/useFeedLibraryMutation';
import { useFeedFaviconRefreshed, useFeedNavigation, type FeedEditTarget } from '@/contexts/FeedContext';
import { ButtonStack, type ButtonConfig } from '@/components/common/ButtonStack';
import { FaviconImage } from '@/components/common/FaviconImage';
import type { Tag } from '@/types/tag';
import {
  applyStationLibraryPatchToExpandedStations,
  applyStationLibraryPatchToTags,
} from '@/services/ui/applyStationLibraryPatch';
import { abortSidebarListDrag, mergePartialReorder } from './sidebarListDrag';
import { persistNestedMembershipOrder, persistStationOrder } from '@/services/feeds/libraryOrderPersist';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { useSidebarReorder } from './useSidebarReorder';
import {
  collectPinnedFeedIds,
  rememberFeedsInCache,
  trimTagManagerFeedCache,
} from './tagManagerFeedCache';
import './TagManager.css';

interface StationFeedItemProps {
  feed: Feed;
  isSelected: boolean;
  onSelectFeed: (feed: Feed) => Promise<void>;
  onOpenFeedEditView: (target: FeedEditTarget) => void;
  setRowRef: (id: string, node: HTMLElement | null) => void;
  onDragStart: (id: string, event: React.DragEvent) => void;
  onDragOver: (id: string, event: React.DragEvent) => void;
  onDrop: (id: string, event: React.DragEvent) => void;
  onDragEnd: () => void;
}

const StationFeedItem = React.memo<StationFeedItemProps>(({
  feed,
  isSelected,
  onSelectFeed,
  onOpenFeedEditView,
  setRowRef,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
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
      ref={(node) => setRowRef(feed.id, node)}
      className={`station-feed-item ${isSelected ? 'station-feed-item-selected' : ''}`}
      draggable
      onClick={(e) => {
        e.stopPropagation();
        void onSelectFeed(feed);
      }}
      onDragStart={(event) => onDragStart(feed.id, event)}
      onDragOver={(event) => onDragOver(feed.id, event)}
      onDrop={(event) => { void onDrop(feed.id, event); }}
      onDragEnd={onDragEnd}
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
  onMembershipReordered: (stationName: string, feedIds: string[]) => void;
  onMembershipReload: () => void;
  setStationRowRef: (id: string, node: HTMLElement | null) => void;
  onStationDragStart: (id: string, event: React.DragEvent) => void;
  onStationDragOver: (id: string, event: React.DragEvent) => void;
  onStationDrop: (id: string, event: React.DragEvent) => void;
  onStationDragEnd: () => void;
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
  onMembershipReordered,
  onMembershipReload,
  setStationRowRef,
  onStationDragStart,
  onStationDragOver,
  onStationDrop,
  onStationDragEnd,
}) => {
  const nestedReorder = useSidebarReorder({
    group: 'nested',
    listKey: tag.name,
    items: stationFeeds,
    getId: (feed) => feed.id,
    persist: async (feedIds) => {
      await persistNestedMembershipOrder(tag.name, feedIds);
    },
    onReorder: (nextFeeds) => {
      onMembershipReordered(tag.name, mergePartialReorder(tag.feedIds, nextFeeds.map((feed) => feed.id)));
    },
    onRollback: onMembershipReload,
  });
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
    <li className={`tag-item-wrapper${isExpanded ? ' is-expanded' : ''}`}>
      <div
        ref={(node) => setStationRowRef(tag.name, node)}
        className={`tag-item ${isSelected ? 'is-selected' : ''}`}
        draggable
        onClick={() => onTagClick(tag.name)}
        onDragStart={(event) => onStationDragStart(tag.name, event)}
        onDragOver={(event) => onStationDragOver(tag.name, event)}
        onDrop={(event) => { void onStationDrop(tag.name, event); }}
        onDragEnd={onStationDragEnd}
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
      <div className="station-feeds-slot">
        <div className="station-feeds-slot-clip">
          <ul
            className="station-feeds-list"
            data-component="station-feeds"
          >
            {isExpanded && stationFeeds.map((feed) => (
              <StationFeedItem
                key={feed.id}
                feed={feed}
                isSelected={selectedFeedId === feed.id}
                onSelectFeed={onSelectFeed}
                onOpenFeedEditView={onOpenFeedEditView}
                setRowRef={nestedReorder.setRowRef}
                onDragStart={nestedReorder.onDragStart}
                onDragOver={nestedReorder.onDragOver}
                onDrop={nestedReorder.onDrop}
                onDragEnd={nestedReorder.onDragEnd}
              />
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
});

export const TagManager: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());
  const [feedCache, setFeedCache] = useState<Map<string, Feed>>(new Map());
  const feedCacheRef = useRef(feedCache);
  const lastAppliedHydrateRevision = useRef(0);
  const expandedStationsRef = useRef(expandedStations);
  expandedStationsRef.current = expandedStations;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const { selectedTag, selectTag, selectedFeedId, selectFeed, openFeedEditView, clearFeedSelection } = useFeedNavigation();
  const feedFaviconRefreshed = useFeedFaviconRefreshed();
  const patchedFeed = useFeedPatchedMutation();
  const feedsCountsUpdated = useFeedsCountsUpdatedMutation();
  const deletedFeed = useFeedDeletedMutation();
  const patchedStation = useStationPatchedMutation();
  const deletedStation = useStationDeletedMutation();
  const hydratedStations = useStationsHydratedMutation();
  const stationsReordered = useStationsReorderedMutation();
  const membershipReordered = useStationMembershipReorderedMutation();

  useEffect(() => {
    feedCacheRef.current = feedCache;
  }, [feedCache]);

  // Collapse / membership shrink must drop non-pinned rows so the Map cannot grow without bound.
  useEffect(() => {
    const pinnedIds = collectPinnedFeedIds(tags, expandedStations);
    setFeedCache((prev) => {
      const trimmed = trimTagManagerFeedCache(prev, pinnedIds);
      if (trimmed === prev) {
        return prev;
      }
      feedCacheRef.current = trimmed;
      return trimmed;
    });
  }, [expandedStations, tags]);

  const ensureFeedsCached = useCallback(async (feedIds: string[]) => {
    const missing = feedIds.filter(id => !feedCacheRef.current.has(id));
    if (missing.length > 0) {
      const fetched = await Promise.all(missing.map(id => feedsManager.getFeedById(id)));
      const feeds = fetched.filter((feed): feed is Feed => Boolean(feed));
      const pinnedIds = collectPinnedFeedIds(
        tagsRef.current,
        expandedStationsRef.current,
        feedIds,
      );
      setFeedCache((prev) => {
        const next = rememberFeedsInCache(prev, feeds, pinnedIds);
        feedCacheRef.current = next;
        return next;
      });
    }

    opmlWorkflowService.scheduleMissingFaviconsAfterStationSelection(feedIds);
  }, []);

  const toggleStation = useCallback((tagName: string) => {
    abortSidebarListDrag();
    setExpandedStations(prev => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
        const tag = tagsRef.current.find(t => t.name === tagName);
        if (tag) void ensureFeedsCached(tag.feedIds);
      }
      return next;
    });
  }, [ensureFeedsCached]);

  const handleStationFeedClick = useCallback(async (feed: Feed) => {
    await selectFeed(feed.id, feed.url, feed.title);
  }, [selectFeed]);

  const loadTags = useCallback(async (options?: { force?: boolean }) => {
    try {
      const allTags = await tagsManager.getAllTags();
      if (
        !options?.force
        && lastAppliedHydrateRevision.current > 0
        && feedLibraryMutationBus.isStationsHydrateFresh()
      ) {
        return;
      }
      setTags(allTags);
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  }, []);

  const handleTagClick = useCallback(async (tagName: string) => {
    try {
      const tag = tags.find((entry) => entry.name === tagName);
      await selectTag(tagName, {}, tag?.feedIds);
    } catch (error) {
      console.error('Error selecting tag:', error);
    }
  }, [selectTag, tags]);

  const handleOpenFeedEditView = useCallback((target: FeedEditTarget) => {
    openFeedEditView(target);
  }, [openFeedEditView]);

  const handleMembershipReordered = useCallback((stationName: string, feedIds: string[]) => {
    setTags((current) => current.map((tag) => (
      tag.name === stationName ? { ...tag, feedIds } : tag
    )));
  }, []);

  const {
    setRowRef: setStationRowRef,
    onDragStart: onStationDragStart,
    onDragOver: onStationDragOver,
    onDrop: onStationDrop,
    onDragEnd: onStationDragEnd,
  } = useSidebarReorder({
    group: 'station',
    listKey: 'stations',
    items: tags,
    getId: (tag) => tag.name,
    persist: persistStationOrder,
    onReorder: setTags,
    onRollback: () => { void loadTags({ force: true }); },
  });

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
        return rememberFeedsInCache(
          prev,
          [updated],
          collectPinnedFeedIds(tagsRef.current, expandedStationsRef.current),
        );
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

      return rememberFeedsInCache(
        prev,
        [{
          ...current,
          ...patchedFeed.changes,
        }],
        collectPinnedFeedIds(tagsRef.current, expandedStationsRef.current),
      );
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

    setTags((prev) => applyStationLibraryPatchToTags(prev, patchedStation));

    let shouldRefreshExpandedFeeds = false;
    setExpandedStations((prev) => {
      const expandedPatch = applyStationLibraryPatchToExpandedStations(prev, patchedStation);
      shouldRefreshExpandedFeeds = expandedPatch.shouldRefreshExpandedFeeds;
      return expandedPatch.expandedStations;
    });

    if (shouldRefreshExpandedFeeds) {
      void ensureFeedsCached(patchedStation.station.feedIds ?? []);
    }
  }, [ensureFeedsCached, patchedStation]);

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
  }, [clearFeedSelection, deletedStation]);

  useEffect(() => {
    if (!hydratedStations || !feedLibraryMutationBus.isStationsHydrateFresh(hydratedStations)) {
      return;
    }

    if (hydratedStations.revision <= lastAppliedHydrateRevision.current) {
      return;
    }

    lastAppliedHydrateRevision.current = hydratedStations.revision;
    setTags(hydratedStations.stations);
    const expandedIds = hydratedStations.stations
      .filter((tag) => expandedStationsRef.current.has(tag.name))
      .flatMap((tag) => tag.feedIds);
    if (expandedIds.length > 0) {
      void ensureFeedsCached(expandedIds);
    }
  }, [ensureFeedsCached, hydratedStations]);

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

  useEffect(() => {
    if (!membershipReordered) {
      return;
    }

    if (!feedLibraryMutationBus.isStationMembershipLeftoverFresh(membershipReordered)) {
      return;
    }

    handleMembershipReordered(membershipReordered.stationName, membershipReordered.feedIds);
  }, [handleMembershipReordered, membershipReordered]);

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
              onMembershipReordered={handleMembershipReordered}
              onMembershipReload={() => { void loadTags({ force: true }); }}
              setStationRowRef={setStationRowRef}
              onStationDragStart={onStationDragStart}
              onStationDragOver={onStationDragOver}
              onStationDrop={onStationDrop}
              onStationDragEnd={onStationDragEnd}
            />
          );
        })}
      </ul>
    </div>
  );
};
