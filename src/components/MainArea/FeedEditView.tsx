import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { TOOLTIPS } from '@/config/tooltips';
import { DEFAULT_SMART_VIEW_DEFINITIONS, type SmartViewId } from '@/constants';
import { LayoutType } from '@/services/settings/types';
import { settingsManager } from '@/services/settings';
import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import {
  formatOpmlImportSummary,
  importOpmlTextIntoLibrary,
  navigateAfterOpmlImport,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { articlesManager } from '@/services/articles/articlesManager';
import { tagsManager } from '@/services/tags/tagsManager';
import {
  isArticleListSearchShortcut,
  isCloseOnEscapeShortcut,
  keybindingService,
} from '@/services/shortcuts/shortcutService';
import { opmlExportService } from '@/services/feeds/opmlExportService';
import { useFeedFaviconRefreshed, useFeedNavigation, useFeedUIActions, type FeedEditTarget } from '@/contexts/FeedContext';
import {
  useFeedDeletedMutation,
  useFeedPatchedMutation,
  useFeedsAddedMutation,
  useStationPatchedMutation,
} from '@/hooks/useFeedLibraryMutation';
import { FaviconImage } from '@/components/common/FaviconImage';
import { DropdownMenu } from '@/components/common/DropdownMenu/DropdownMenu';
import { EmojiSubmenu } from '@/components/common/EmojiPicker/EmojiSubmenu';
import { NotificationToast } from '@/components/common/NotificationToast';
import { Modal } from '@/components/common/Modal';
import type { Tag } from '@/types/tag';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { appToastService } from '@/services/ui/appToastService';
import { useResizeObserverEffect } from '@/hooks/useLifecycleEffects';
import { isValidUrl } from '@/utils/urlValidator';
import { FeedEditWidgets } from './FeedEditWidgets';
import './ArticleList.css';
import './FeedEditView.css';
import './FeedEditWidgets.css';

interface FeedEditViewProps {
  layout?: LayoutType;
}

interface FeedEditRow {
  feed: Feed;
  stationNames: string[];
}

interface StationEditRow {
  station: Tag;
  feedCount: number;
}

interface LibraryItemRow {
  id: SmartViewId;
  label: string;
  visible: boolean;
  sortOrder: number;
}

type FeedSortDirection = 'desc' | 'asc' | 'none';
type FeedSortField = 'title' | 'status' | 'articleCount' | 'station' | 'subscribedTime';
type FeedDeleteState = { id: string; title: string };
type StationDeleteState = { name: string };
type DragGroup = 'library' | 'station';

interface FeedSortConfig {
  field: FeedSortField;
  direction: FeedSortDirection;
}

type FeedColumnKey = 'emoji' | 'favicon' | 'title' | 'url' | 'status' | 'articleCount' | 'station' | 'subscribedTime';
type FeedColumnWidthMap = Record<FeedColumnKey, number>;

const FEED_EDIT_DEFAULT_COLUMN_WIDTHS: FeedColumnWidthMap = {
  emoji: 64,
  favicon: 72,
  title: 280,
  url: 420,
  status: 80,
  articleCount: 130,
  station: 220,
  subscribedTime: 180,
};

const FEED_EDIT_MIN_COLUMN_WIDTHS: FeedColumnWidthMap = {
  emoji: 56,
  favicon: 64,
  title: 180,
  url: 180,
  status: 60,
  articleCount: 100,
  station: 140,
  subscribedTime: 140,
};

interface FeedColumnResizeState {
  column: FeedColumnKey;
  startX: number;
  startWidth: number;
}

interface FeedTitleEditState {
  feedId: string;
  draftTitle: string;
  originalTitle: string;
}

interface FeedUrlEditState {
  feedId: string;
  draftUrl: string;
  originalUrl: string;
}

interface FeedStationEditState {
  feedId: string;
  draftStationNames: string[];
  anchorEl: HTMLElement;
}

interface StationNameEditState {
  stationName: string;
  draftName: string;
  originalName: string;
}

type EmojiEditTarget = { kind: 'feed' | 'station'; id: string };

type EmojiMenuState = EmojiEditTarget & { anchorEl: HTMLElement };

interface DragState {
  group: DragGroup;
  id: string;
  overId: string | null;
  placement: 'before' | 'after';
}

const STATION_TABLE_COLUMN_WIDTHS = {
  drag: 52,
  emoji: 72,
  name: 280,
  feedCount: 156,
  createdAt: 180,
  action: 64,
} as const;

const FEED_EDIT_ACTION_COLUMN_WIDTH = 64;
const FEED_EDIT_JUMP_SCROLL_DURATION_MS = 280;
const FEED_EDIT_JUMP_FLASH_DURATION_MS = 480;

const orderStationNames = (stationNames: string[], orderedStations: Tag[]): string[] => {
  const selectedNames = new Set(stationNames);
  return orderedStations
    .map((station) => station.name)
    .filter((stationName) => selectedNames.has(stationName));
};

const areStringArraysEqual = (left: string[], right: string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const buildNextStationName = (stations: Tag[]): string => {
  const baseName = 'New station';
  const existingNames = new Set(stations.map((station) => station.name));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let nextIndex = 2;
  while (existingNames.has(`${baseName} ${nextIndex}`)) {
    nextIndex += 1;
  }

  return `${baseName} ${nextIndex}`;
};

interface FeedEditFeedRowProps {
  feed: Feed;
  stationNames: string[];
  isSearchMatch: boolean;
  isCurrentSearchMatch: boolean;
  titleEditState: FeedTitleEditState | null;
  urlEditState: FeedUrlEditState | null;
  stationEditState: FeedStationEditState | null;
  stationOptions: string[];
  stationMenuRef: React.RefObject<HTMLDivElement | null>;
  attachRowRef: (feedId: string, node: HTMLTableRowElement | null) => void;
  onEmojiButtonClick: (event: React.MouseEvent<HTMLButtonElement>, target: { kind: 'feed' | 'station'; id: string }) => void;
  isEmojiButtonActive: boolean;
  onStartTitleEdit: (feed: Feed) => void;
  onUpdateTitleDraft: (feedId: string, draftTitle: string) => void;
  onCommitTitleEdit: (state: FeedTitleEditState) => Promise<void>;
  onStartUrlEdit: (feed: Feed) => void;
  onUpdateUrlDraft: (feedId: string, draftUrl: string) => void;
  onCommitUrlEdit: (state: FeedUrlEditState) => Promise<void>;
  onStartStationEdit: (
    event: React.MouseEvent<HTMLTableCellElement>,
    feed: Feed,
    stationNames: string[]
  ) => void;
  onToggleStationDraft: (feedId: string, stationName: string) => void;
  onRequestDelete: (feed: Feed) => void;
}

interface FeedEditStationRowProps {
  station: Tag;
  feedCount: number;
  attachRowRef: (stationName: string, node: HTMLTableRowElement | null) => void;
  stationNameEditState: StationNameEditState | null;
  onRowDragStart: (group: DragGroup, id: string, event: React.DragEvent<HTMLSpanElement>) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => void;
  onRowDrop: (group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => Promise<void>;
  onEmojiButtonClick: (event: React.MouseEvent<HTMLButtonElement>, target: { kind: 'feed' | 'station'; id: string }) => void;
  isEmojiButtonActive: boolean;
  onStartStationNameEdit: (station: Tag) => void;
  onUpdateStationNameDraft: (stationName: string, draftName: string) => void;
  onCommitStationNameEdit: (state: StationNameEditState) => Promise<void>;
  onRequestDelete: (stationName: string) => void;
}

interface FeedEditLibraryRowProps {
  item: LibraryItemRow;
  attachRowRef: (itemId: string, node: HTMLTableRowElement | null) => void;
  onRowDragStart: (group: DragGroup, id: string, event: React.DragEvent<HTMLSpanElement>) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => void;
  onRowDrop: (group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => Promise<void>;
  onToggleVisibility: (viewId: SmartViewId) => void;
}

interface FeedEditDragHandleProps {
  label: string;
  onDragStart: (event: React.DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
}

const FeedEditDragHandle: React.FC<FeedEditDragHandleProps> = ({ label, onDragStart, onDragEnd }) => (
  <span
    role="button"
    tabIndex={0}
    className="feed-edit-drag-handle"
    draggable
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    aria-label={`Reorder ${label}`}
    title={`Drag to reorder ${label}`}
  >
    <DragIndicatorRoundedIcon fontSize="small" />
  </span>
);

interface FeedEditTableViewportProps {
  colgroup?: React.ReactNode;
  header: React.ReactNode;
  body: React.ReactNode;
  tableClassName?: string;
  section?: string;
  tableWidth?: number;
}

const formatDateTime = (value?: Date | string): string => {
  if (!value) return '—';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const sortByManualOrder = <T extends { sortOrder?: number }>(
  items: T[],
  getLabel: (item: T) => string
): T[] =>
  [...items].sort((a, b) => {
    const sortOrderDiff = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
    if (sortOrderDiff !== 0) {
      return sortOrderDiff;
    }

    return getLabel(a).localeCompare(getLabel(b), undefined, { sensitivity: 'base' });
  });

const sortStationsByAddedDateDesc = (items: Tag[]): Tag[] =>
  [...items].sort((a, b) => {
    // Keep explicit drag order first, but default unordered stations to newest-first.
    const sortOrderDiff = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
    if (sortOrderDiff !== 0) {
      return sortOrderDiff;
    }

    const createdAtDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

const reorderList = <T,>(
  items: T[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after',
  getId: (item: T) => string
): T[] => {
  const draggedIndex = items.findIndex((item) => getId(item) === draggedId);
  const targetIndex = items.findIndex((item) => getId(item) === targetId);

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(draggedIndex, 1);
  const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex;

  nextItems.splice(insertIndex, 0, draggedItem);
  return nextItems;
};

const useLatestRef = <T,>(value: T) => {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
};

const easeInOutCubic = (progress: number): number => (
  progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
);

const getCenteredScrollTop = (
  container: HTMLElement,
  row: HTMLTableRowElement,
): number => {
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const nextScrollTop = (
    container.scrollTop
    + (rowRect.top - containerRect.top)
    - ((container.clientHeight - rowRect.height) / 2)
  );
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

  return Math.min(Math.max(0, nextScrollTop), maxScrollTop);
};

const animateScrollTop = (
  container: HTMLElement,
  targetScrollTop: number,
  onComplete: () => void,
): (() => void) => {
  const startScrollTop = container.scrollTop;
  const scrollDistance = targetScrollTop - startScrollTop;
  if (Math.abs(scrollDistance) < 1) {
    container.scrollTop = targetScrollTop;
    onComplete();
    return () => {};
  }

  const startTime = performance.now();
  let frameId = 0;

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / FEED_EDIT_JUMP_SCROLL_DURATION_MS, 1);
    const easedProgress = easeInOutCubic(progress);

    container.scrollTop = startScrollTop + (scrollDistance * easedProgress);

    if (progress < 1) {
      frameId = window.requestAnimationFrame(step);
      return;
    }

    container.scrollTop = targetScrollTop;
    onComplete();
  };

  frameId = window.requestAnimationFrame(step);

  return () => {
    window.cancelAnimationFrame(frameId);
  };
};

const flashFeedEditRow = (row: HTMLTableRowElement): void => {
  row.classList.add('is-jump-target');
  window.setTimeout(() => {
    row.classList.remove('is-jump-target');
  }, FEED_EDIT_JUMP_FLASH_DURATION_MS);
};

const FeedEditTableViewport: React.FC<FeedEditTableViewportProps> = ({
  colgroup,
  header,
  body,
  tableClassName = '',
  section,
  tableWidth,
}) => {
  const headerTrackRef = useRef<HTMLDivElement | null>(null);
  const headerTableRef = useRef<HTMLTableElement | null>(null);
  const bodyShellRef = useRef<HTMLDivElement | null>(null);
  const bodyTableRef = useRef<HTMLTableElement | null>(null);

  const syncHeaderLayout = useCallback(() => {
    const headerTrack = headerTrackRef.current;
    const headerTable = headerTableRef.current;
    const bodyShell = bodyShellRef.current;
    const bodyTable = bodyTableRef.current;
    if (!headerTrack || !headerTable || !bodyShell || !bodyTable) return;

    const viewportWidth = bodyShell.clientWidth;
    const bodyTableWidth = Math.ceil(bodyTable.getBoundingClientRect().width);
    const resolvedTableWidth = tableWidth ?? bodyTableWidth;
    const trackWidth = Math.max(resolvedTableWidth, viewportWidth);

    headerTrack.style.width = `${trackWidth}px`;
    headerTable.style.width = `${resolvedTableWidth}px`;
    headerTable.style.minWidth = `${resolvedTableWidth}px`;
    bodyTable.style.width = `${resolvedTableWidth}px`;
    bodyTable.style.minWidth = `${resolvedTableWidth}px`;
    headerTrack.style.transform = `translateX(${-bodyShell.scrollLeft}px)`;

    if (tableWidth) return;

    const headerCells = Array.from(headerTable.tHead?.rows[0]?.cells ?? []);
    const bodyCells = Array.from(bodyTable.tBodies[0]?.rows[0]?.cells ?? []);
    if (headerCells.length !== bodyCells.length) return;

    headerCells.forEach((headerCell, index) => {
      const cellWidth = `${Math.ceil(bodyCells[index].getBoundingClientRect().width)}px`;
      headerCell.style.width = cellWidth;
      headerCell.style.minWidth = cellWidth;
      headerCell.style.maxWidth = cellWidth;
    });
  }, [tableWidth]);

  useResizeObserverEffect(bodyShellRef, syncHeaderLayout);
  useResizeObserverEffect(bodyTableRef, syncHeaderLayout);
  useEffect(() => {
    syncHeaderLayout();
  });

  const handleBodyScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!headerTrackRef.current) return;
    headerTrackRef.current.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`;
  }, []);

  return (
    <div className="feed-edit-table-viewport" data-section={section}>
      <div className="feed-edit-table-header-shell">
        <div ref={headerTrackRef} className="feed-edit-table-header-track">
          <table
            ref={headerTableRef}
            className={`table table-zebra table-sm feed-edit-table feed-edit-group-table ${tableClassName}`.trim()}
          >
            {colgroup}
            <thead>{header}</thead>
          </table>
        </div>
      </div>
      <div ref={bodyShellRef} className="feed-edit-table-body-shell" onScroll={handleBodyScroll}>
        <table
          ref={bodyTableRef}
          className={`table table-zebra table-sm feed-edit-table feed-edit-group-table ${tableClassName}`.trim()}
        >
          {colgroup}
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
};

const FeedEditFeedRow = React.memo<FeedEditFeedRowProps>(({
  feed,
  stationNames,
  isSearchMatch,
  isCurrentSearchMatch,
  titleEditState,
  urlEditState,
  stationEditState,
  stationOptions,
  stationMenuRef,
  attachRowRef,
  onEmojiButtonClick,
  isEmojiButtonActive,
  onStartTitleEdit,
  onUpdateTitleDraft,
  onCommitTitleEdit,
  onStartUrlEdit,
  onUpdateUrlDraft,
  onCommitUrlEdit,
  onStartStationEdit,
  onToggleStationDraft,
  onRequestDelete,
}) => (
  <tr
    ref={(node) => {
      attachRowRef(feed.id, node);
    }}
    className={[
      isSearchMatch ? 'is-search-match' : '',
      isCurrentSearchMatch ? 'is-search-current-match' : '',
    ].filter(Boolean).join(' ')}
  >
    <td>
      <button
        type="button"
        className={`feed-edit-emoji-cell-button ${isEmojiButtonActive ? 'is-active' : ''}`}
        onClick={(event) => onEmojiButtonClick(event, { kind: 'feed', id: feed.id })}
        title={feed.emoji ? 'Change emoji' : 'Set emoji'}
        aria-label={`${feed.emoji ? 'Change' : 'Set'} emoji for ${feed.title}`}
      >
        {feed.emoji || '—'}
      </button>
    </td>
    <td>
      <div className="feed-edit-favicon-cell">
        {feed.favicon?.startsWith('data:') ? (
          <FaviconImage
            localFavicon={feed.favicon}
            hasTransparency={feed.faviconHasTransparency}
            alt={feed.title}
            itemId={feed.id}
          />
        ) : (
          <span className="favicon-container feed-edit-favicon-placeholder" aria-hidden="true" />
        )}
      </div>
    </td>
    <td
      className="feed-edit-cell-title feed-edit-cell-title-editable"
      onClick={() => onStartTitleEdit(feed)}
    >
      {titleEditState ? (
        <input
          type="text"
          className="feed-edit-title-input"
          value={titleEditState.draftTitle}
          onChange={(event) => onUpdateTitleDraft(feed.id, event.target.value)}
          onBlur={() => { void onCommitTitleEdit(titleEditState); }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Enter') return;
            event.preventDefault();
            void onCommitTitleEdit(titleEditState);
          }}
          autoFocus
        />
      ) : (
        feed.title
      )}
    </td>
    <td
      className="feed-edit-cell-station feed-edit-cell-station-editable"
      onClick={(event) => onStartStationEdit(event, feed, stationNames)}
    >
      <div className="feed-edit-station-trigger">
        <span className="feed-edit-station-label">
          {stationEditState
            ? (stationEditState.draftStationNames.length > 0 ? stationEditState.draftStationNames.join(', ') : '—')
            : (stationNames.length > 0 ? stationNames.join(', ') : '—')}
        </span>
        <DropdownMenu
          isOpen={!!stationEditState}
          menuRef={stationMenuRef}
          className="feed-edit-station-dropdown"
          align="left"
        >
          {stationOptions.length > 0 ? stationOptions.map((stationName) => (
            <label key={stationName} className="dropdown-menu-option">
              <input
                type="checkbox"
                className="dropdown-menu-checkbox"
                checked={stationEditState?.draftStationNames.includes(stationName) ?? false}
                onChange={() => onToggleStationDraft(feed.id, stationName)}
              />
              <span>{stationName}</span>
            </label>
          )) : (
            <div className="dropdown-menu-empty">No stations available.</div>
          )}
        </DropdownMenu>
      </div>
    </td>
    <td
      className="feed-edit-cell-url feed-edit-cell-url-editable"
      onClick={() => onStartUrlEdit(feed)}
    >
      {urlEditState ? (
        <input
          type="text"
          className="feed-edit-title-input"
          value={urlEditState.draftUrl}
          onChange={(event) => onUpdateUrlDraft(feed.id, event.target.value)}
          onBlur={() => { void onCommitUrlEdit(urlEditState); }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Enter') return;
            event.preventDefault();
            void onCommitUrlEdit(urlEditState);
          }}
          autoFocus
        />
      ) : (
        feed.url
      )}
    </td>
    <td>
      <div className="feed-edit-status-cell">
        <span
          className={`feed-edit-status-dot ${
            (feed.consecutiveFailures ?? 0) > 0 ? 'status-failed' : 'status-success'
          }`}
          title={
            (feed.consecutiveFailures ?? 0) > 0
              ? `Failed connection (${feed.consecutiveFailures} consecutive failures)`
              : 'Connection successful'
          }
        />
      </div>
    </td>
    <td>{feed.articleCount ?? 0}</td>
    <td>{formatDateTime(feed.createdAt)}</td>
    <td className="feed-edit-action-col">
      <div className="feed-edit-row-actions">
        <button
          type="button"
          className="feed-edit-delete-button"
          title={`Delete ${feed.title}`}
          aria-label={`Delete ${feed.title}`}
          onClick={() => onRequestDelete(feed)}
        >
          <DeleteOutlineRoundedIcon fontSize="small" />
        </button>
      </div>
    </td>
  </tr>
));

const FeedEditStationRow = React.memo<FeedEditStationRowProps>(({
  station,
  feedCount,
  attachRowRef,
  stationNameEditState,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDrop,
  onEmojiButtonClick,
  isEmojiButtonActive,
  onStartStationNameEdit,
  onUpdateStationNameDraft,
  onCommitStationNameEdit,
  onRequestDelete,
}) => (
  <tr
    ref={(node) => {
      attachRowRef(station.name, node);
    }}
    onDragOver={(event) => onRowDragOver('station', station.name, event)}
    onDrop={(event) => { void onRowDrop('station', station.name, event); }}
  >
    <td className="feed-edit-drag-col">
      <FeedEditDragHandle
        label={station.name}
        onDragStart={(event) => onRowDragStart('station', station.name, event)}
        onDragEnd={onRowDragEnd}
      />
    </td>
    <td>
      <button
        type="button"
        className={`feed-edit-emoji-cell-button ${isEmojiButtonActive ? 'is-active' : ''}`}
        onClick={(event) => onEmojiButtonClick(event, { kind: 'station', id: station.name })}
        title={station.emoji ? 'Change station emoji' : 'Set station emoji'}
        aria-label={`${station.emoji ? 'Change' : 'Set'} emoji for ${station.name}`}
      >
        {station.emoji || '—'}
      </button>
    </td>
    <td
      className="feed-edit-cell-title feed-edit-cell-title-editable"
      onClick={() => onStartStationNameEdit(station)}
    >
      {stationNameEditState ? (
        <input
          type="text"
          className="feed-edit-title-input"
          value={stationNameEditState.draftName}
          onChange={(event) => onUpdateStationNameDraft(station.name, event.target.value)}
          onBlur={() => { void onCommitStationNameEdit(stationNameEditState); }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Enter') return;
            event.preventDefault();
            void onCommitStationNameEdit(stationNameEditState);
          }}
          autoFocus
        />
      ) : (
        station.name
      )}
    </td>
    <td>{feedCount}</td>
    <td>{formatDateTime(station.createdAt)}</td>
    <td className="feed-edit-action-col">
      <div className="feed-edit-row-actions">
        <button
          type="button"
          className="feed-edit-delete-button"
          title={`Delete station ${station.name}`}
          aria-label={`Delete station ${station.name}`}
          onClick={() => onRequestDelete(station.name)}
        >
          <DeleteOutlineRoundedIcon fontSize="small" />
        </button>
      </div>
    </td>
  </tr>
));

const FeedEditLibraryRow = React.memo<FeedEditLibraryRowProps>(({
  item,
  attachRowRef,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDrop,
  onToggleVisibility,
}) => (
  <tr
    ref={(node) => {
      attachRowRef(item.id, node);
    }}
    onDragOver={(event) => onRowDragOver('library', item.id, event)}
    onDrop={(event) => { void onRowDrop('library', item.id, event); }}
  >
    <td className="feed-edit-drag-col">
      <FeedEditDragHandle
        label={item.label}
        onDragStart={(event) => onRowDragStart('library', item.id, event)}
        onDragEnd={onRowDragEnd}
      />
    </td>
    <td className="feed-edit-cell-title">{item.label}</td>
    <td className="feed-edit-visibility-col">
      <button
        type="button"
        className="feed-edit-visibility-button"
        onClick={() => onToggleVisibility(item.id)}
        aria-label={item.visible ? `Hide ${item.label}` : `Show ${item.label}`}
        title={item.visible ? `Hide ${item.label}` : `Show ${item.label}`}
      >
        {item.visible ? (
          <VisibilityOutlinedIcon fontSize="small" />
        ) : (
          <VisibilityOffOutlinedIcon fontSize="small" />
        )}
      </button>
    </td>
  </tr>
));

const buildLibraryItemRows = (
  smartViews: Array<{ id: SmartViewId; visible: boolean; sortOrder: number }>
): LibraryItemRow[] => {
  const smartViewMap = new Map(smartViews.map((view) => [view.id, view]));

  return DEFAULT_SMART_VIEW_DEFINITIONS.map((definition, index) => {
    const existing = smartViewMap.get(definition.id);

    return {
      id: definition.id,
      label: definition.label,
      visible: existing?.visible ?? true,
      sortOrder: existing?.sortOrder ?? index,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
};

export const FeedEditView: React.FC<FeedEditViewProps> = ({ layout: _layout = '2-column' }) => {
  void _layout;

  const {
    selectedFeedId,
    clearFeedSelection,
    feedEditTarget,
    clearFeedEditTarget,
    selectFeed,
    selectTag,
  } = useFeedNavigation();

  const { refreshTotalFeeds, notifyFeedLibraryChanged } = useFeedUIActions();
  const feedFaviconRefreshed = useFeedFaviconRefreshed();
  const patchedFeed = useFeedPatchedMutation();
  const deletedFeed = useFeedDeletedMutation();
  const patchedStation = useStationPatchedMutation();
  const addedFeeds = useFeedsAddedMutation();

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [stations, setStations] = useState<Tag[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItemRow[]>([]);
  const [feedToStationsMap, setFeedToStationsMap] = useState<Map<string, string[]>>(new Map());
  const [sortConfig, setSortConfig] = useState<FeedSortConfig>({
    field: 'subscribedTime',
    direction: 'desc',
  });
  const [columnWidths, setColumnWidths] = useState<FeedColumnWidthMap>(FEED_EDIT_DEFAULT_COLUMN_WIDTHS);
  const [activeResizeColumn, setActiveResizeColumn] = useState<FeedColumnKey | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [titleEditState, setTitleEditState] = useState<FeedTitleEditState | null>(null);
  const [urlEditState, setUrlEditState] = useState<FeedUrlEditState | null>(null);
  const [stationEditState, setStationEditState] = useState<FeedStationEditState | null>(null);
  const [stationNameEditState, setStationNameEditState] = useState<StationNameEditState | null>(null);
  const [activeEmojiTarget, setActiveEmojiTarget] = useState<EmojiEditTarget | null>(null);
  const [emojiMenuState, setEmojiMenuState] = useState<EmojiMenuState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpmlActionLoading, setIsOpmlActionLoading] = useState(false);
  const [isFeedDeleteActionLoading, setIsFeedDeleteActionLoading] = useState(false);
  const [isStationDeleteActionLoading, setIsStationDeleteActionLoading] = useState(false);
  const [feedToDelete, setFeedToDelete] = useState<FeedDeleteState | null>(null);
  const [stationToDelete, setStationToDelete] = useState<StationDeleteState | null>(null);
  const [opmlActionMessage, setOpmlActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resizeStateRef = useRef<FeedColumnResizeState | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const stationRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const libraryRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const stationMenuRef = useRef<HTMLDivElement | null>(null);
  const opmlActionToastTimerRef = useRef<number | null>(null);
  const stationsRef = useLatestRef(stations);
  const feedsRef = useLatestRef(feeds);
  const feedToStationsMapRef = useLatestRef(feedToStationsMap);
  const libraryItemsRef = useLatestRef(libraryItems);
  const dragStateRef = useRef<DragState | null>(null);
  const stationNameCommitKeyRef = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [allFeeds, allTags, smartViews] = await Promise.all([
        feedsManager.getAllFeeds(),
        tagsManager.getAllTags(),
        settingsManager.getSmartViews(),
      ]);

      const orderedStations = sortStationsByAddedDateDesc(allTags);
      const nextMap = new Map<string, string[]>();

      for (const tag of orderedStations) {
        for (const feedId of tag.feedIds) {
          const existing = nextMap.get(feedId) || [];
          existing.push(tag.name);
          nextMap.set(feedId, existing);
        }
      }

      setFeeds(sortByManualOrder(allFeeds, (feed) => feed.title));
      setStations(orderedStations);
      setLibraryItems(buildLibraryItemRows(smartViews));
      setFeedToStationsMap(nextMap);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load feed editor.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (opmlActionToastTimerRef.current !== null) {
        window.clearTimeout(opmlActionToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!feedFaviconRefreshed) return;
    const { feedId } = feedFaviconRefreshed;
    feedsManager.getFeedById(feedId).then((updatedFeed) => {
      if (!updatedFeed) return;

      setFeeds((current) => current.map((feed) => (
        feed.id === feedId
          ? {
            ...feed,
            favicon: updatedFeed.favicon,
            faviconHasTransparency: updatedFeed.faviconHasTransparency,
            faviconBgLight: updatedFeed.faviconBgLight,
            faviconBgDark: updatedFeed.faviconBgDark,
          }
          : feed
      )));
    });
  }, [feedFaviconRefreshed]);

  useEffect(() => {
    if (!addedFeeds) return;

    setFeeds((current) => {
      const existingIds = new Set(current.map((feed) => feed.id));
      const nextFeeds = addedFeeds.feeds.filter((feed) => !existingIds.has(feed.id));
      if (nextFeeds.length === 0) {
        return current;
      }

      return sortByManualOrder([...current, ...nextFeeds], (feed) => feed.title);
    });
    setFeedToStationsMap((current) => {
      const next = new Map(current);
      let hasChanges = false;

      for (const feed of addedFeeds.feeds) {
        if (!feed.tags || feed.tags.length === 0 || next.has(feed.id)) {
          continue;
        }

        next.set(feed.id, [...feed.tags]);
        hasChanges = true;
      }

      return hasChanges ? next : current;
    });
  }, [addedFeeds]);

  useEffect(() => {
    if (!patchedFeed) return;

    setFeeds((current) => current.map((feed) => (
      feed.id === patchedFeed.feedId
        ? { ...feed, ...patchedFeed.changes }
        : feed
    )));

    if (patchedFeed.changes.tags) {
      setFeedToStationsMap((current) => {
        const currentTags = current.get(patchedFeed.feedId) || [];
        if (areStringArraysEqual(currentTags, patchedFeed.changes.tags ?? [])) {
          return current;
        }

        const next = new Map(current);
        if ((patchedFeed.changes.tags?.length ?? 0) === 0) {
          next.delete(patchedFeed.feedId);
        } else {
          next.set(patchedFeed.feedId, [...(patchedFeed.changes.tags ?? [])]);
        }
        return next;
      });
    }
  }, [patchedFeed]);

  useEffect(() => {
    if (!deletedFeed) return;

    setFeeds((current) => current.filter((feed) => feed.id !== deletedFeed.feedId));
    setFeedToStationsMap((current) => {
      if (!current.has(deletedFeed.feedId)) {
        return current;
      }

      const next = new Map(current);
      next.delete(deletedFeed.feedId);
      return next;
    });
  }, [deletedFeed]);

  useEffect(() => {
    if (!patchedStation) return;

    setStations((current) => {
      let hasPatchedStation = false;
      const nextStations = current.map((station) => {
        if (
          station.name !== patchedStation.previousName
          && station.name !== patchedStation.station.name
        ) {
          return station;
        }

        hasPatchedStation = true;
        return {
          ...station,
          ...patchedStation.station,
        };
      });

      if (hasPatchedStation) {
        const seenNames = new Set<string>();
        const dedupedStations = nextStations.filter((station) => {
          if (seenNames.has(station.name)) {
            return false;
          }

          seenNames.add(station.name);
          return true;
        });
        return dedupedStations;
      }

      return sortStationsByAddedDateDesc([
        ...current,
        {
          ...patchedStation.station,
          color: undefined,
        },
      ]);
    });
  }, [patchedStation]);

  const showOpmlActionMessage = useCallback((message: string) => {
    setOpmlActionMessage(message);

    if (opmlActionToastTimerRef.current !== null) {
      window.clearTimeout(opmlActionToastTimerRef.current);
    }

    opmlActionToastTimerRef.current = window.setTimeout(() => {
      setOpmlActionMessage(null);
      opmlActionToastTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const minWidth = FEED_EDIT_MIN_COLUMN_WIDTHS[resizeState.column];
      const nextWidth = Math.max(minWidth, resizeState.startWidth + event.clientX - resizeState.startX);

      setColumnWidths((current) => ({
        ...current,
        [resizeState.column]: nextWidth,
      }));
    };

    const stopResizing = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      setActiveResizeColumn(null);
      document.body.classList.remove('feed-edit-col-resizing');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
      document.body.classList.remove('feed-edit-col-resizing');
    };
  }, []);

  useEffect(() => {
    if (!emojiMenuState) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (emojiMenuState.anchorEl.contains(target)) return;
      if (target.closest('.emoji-submenu')) return;
      setEmojiMenuState(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [emojiMenuState]);

  const updateFeedEmoji = useCallback(async (feedId: string, emoji?: string) => {
    try {
      const updatedFeed = await feedsManager.updateFeed(feedId, { emoji });
      if (!updatedFeed) {
        appToastService.show('Failed to update feed icon.');
        return;
      }

      setFeeds((current) =>
        current.map((feed) =>
          feed.id === feedId
            ? { ...feed, emoji: updatedFeed.emoji }
            : feed
        )
      );
      feedLibraryMutationBus.publishFeedPatched(feedId, { emoji: updatedFeed.emoji });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update feed icon.';
      appToastService.show(message);
    }
  }, []);

  const updateStationEmoji = useCallback(async (stationName: string, emoji?: string) => {
    try {
      const updatedStation = await tagsManager.updateTag(stationName, { emoji });
      if (!updatedStation) {
        appToastService.show('Failed to update station emoji.');
        return;
      }

      setStations((current) =>
        current.map((station) =>
          station.name === stationName
            ? { ...station, emoji: updatedStation.emoji }
            : station
        )
      );
      feedLibraryMutationBus.publishStationPatched(stationName, {
        name: updatedStation.name,
        emoji: updatedStation.emoji,
        feedIds: updatedStation.feedIds,
        createdAt: updatedStation.createdAt,
        sortOrder: updatedStation.sortOrder,
      });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update station emoji.';
      appToastService.show(message);
    }
  }, []);

  // Keep emoji deletion attached to the active target, but only after the picker is dismissed.
  useEffect(() => {
    if (!activeEmojiTarget) return;

    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 1000,
      handler: (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (emojiMenuState) return;
        if (isEditableKeyboardTarget(event.target)) return;
        if (event.key !== 'Backspace' && event.key !== 'Delete') return;

        event.preventDefault();
        event.stopPropagation();

        if (activeEmojiTarget.kind === 'feed') {
          void updateFeedEmoji(activeEmojiTarget.id, '');
          return;
        }

        void updateStationEmoji(activeEmojiTarget.id, '');
      },
    });
  }, [activeEmojiTarget, emojiMenuState, updateFeedEmoji, updateStationEmoji]);

  const startColumnResize = (event: React.MouseEvent<HTMLButtonElement>, column: FeedColumnKey) => {
    event.preventDefault();
    event.stopPropagation();

    resizeStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column],
    };
    setActiveResizeColumn(column);
    document.body.classList.add('feed-edit-col-resizing');
  };

  const startTitleEdit = useCallback((feed: Feed) => {
    setTitleEditState((current) => {
      if (current?.feedId === feed.id) return current;
      return {
        feedId: feed.id,
        draftTitle: feed.title,
        originalTitle: feed.title,
      };
    });
  }, []);

  const startUrlEdit = useCallback((feed: Feed) => {
    setUrlEditState((current) => {
      if (current?.feedId === feed.id) return current;
      return {
        feedId: feed.id,
        draftUrl: feed.url,
        originalUrl: feed.url,
      };
    });
  }, []);

  const startStationEdit = useCallback((
    event: React.MouseEvent<HTMLTableCellElement>,
    feed: Feed,
    stationNames: string[]
  ) => {
    const anchorEl = event.currentTarget;
    setStationEditState((current) => {
      if (current?.feedId === feed.id) return current;
      return {
        feedId: feed.id,
        draftStationNames: [...stationNames],
        anchorEl,
      };
    });
  }, []);

  const startStationNameEdit = useCallback((station: Tag) => {
    setStationNameEditState((current) => {
      if (current?.stationName === station.name) return current;
      return {
        stationName: station.name,
        draftName: station.name,
        originalName: station.name,
      };
    });
  }, []);

  const handleEmojiButtonClick = useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    target: { kind: 'feed' | 'station'; id: string }
  ) => {
    const anchorEl = event.currentTarget;
    setActiveEmojiTarget(target);
    setEmojiMenuState((current) => {
      if (current?.kind === target.kind && current.id === target.id) return null;
      return { ...target, anchorEl };
    });
  }, []);

  const handleAddStation = useCallback(async () => {
    const nextSortOrder = stationsRef.current.reduce(
      (maxSortOrder, station) => Math.max(maxSortOrder, station.sortOrder ?? -1),
      -1
    ) + 1;
    // Seed a persisted row immediately so the new station appears at the bottom of the table.
    const nextStation: Tag = {
      name: buildNextStationName(stationsRef.current),
      feedIds: [],
      createdAt: new Date().toISOString(),
      sortOrder: nextSortOrder,
    };

    try {
      await tagsManager.saveTag(nextStation);
      setStations((current) => [...current, nextStation]);
      feedLibraryMutationBus.publishStationPatched(nextStation.name, {
        name: nextStation.name,
        emoji: nextStation.emoji,
        feedIds: nextStation.feedIds,
        createdAt: nextStation.createdAt,
        sortOrder: nextStation.sortOrder,
      });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to add station.';
      appToastService.show(message);
    }
  }, [stationsRef]);

  const handleEmojiSelect = async (emoji: string) => {
    if (!emojiMenuState) return;

    const menuState = emojiMenuState;
    setEmojiMenuState(null);

    if (menuState.kind === 'feed') {
      await updateFeedEmoji(menuState.id, emoji);
      return;
    }

    await updateStationEmoji(menuState.id, emoji);
  };

  const commitTitleEdit = useCallback(async (state: FeedTitleEditState) => {
    const nextTitle = state.draftTitle.trim();
    setTitleEditState(null);

    if (!nextTitle || nextTitle === state.originalTitle) return;

    try {
      const updatedFeed = await feedsManager.updateFeed(state.feedId, { title: nextTitle });
      if (!updatedFeed) {
        appToastService.show('Failed to update feed title.');
        return;
      }

      setFeeds((current) =>
        current.map((feed) =>
          feed.id === state.feedId
            ? { ...feed, title: updatedFeed.title }
            : feed
        )
      );
      feedLibraryMutationBus.publishFeedPatched(state.feedId, { title: updatedFeed.title });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update feed title.';
      appToastService.show(message);
    }
  }, []);

  // Reuse the title-cell inline editing flow, but keep feed URLs validated and unique.
  const commitUrlEdit = useCallback(async (state: FeedUrlEditState) => {
    const nextUrl = state.draftUrl.trim();
    setUrlEditState(null);

    if (!nextUrl || nextUrl === state.originalUrl) return;

    if (!isValidUrl(nextUrl)) {
      appToastService.show('Please enter a valid URL (http:// or https://).');
      return;
    }

    try {
      const existingFeed = await feedsManager.getFeedByUrl(nextUrl);
      if (existingFeed && existingFeed.id !== state.feedId) {
        appToastService.show('This feed URL already exists in your library.');
        return;
      }

      const updatedFeed = await feedsManager.updateFeed(state.feedId, { url: nextUrl });
      if (!updatedFeed) {
        appToastService.show('Failed to update feed URL.');
        return;
      }

      setFeeds((current) =>
        current.map((feed) =>
          feed.id === state.feedId
            ? { ...feed, url: updatedFeed.url }
            : feed
        )
      );
      feedLibraryMutationBus.publishFeedPatched(state.feedId, { url: updatedFeed.url });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update feed URL.';
      appToastService.show(message);
    }
  }, []);

  const applyStationSelection = useCallback(async (
    feedId: string,
    stationName: string,
    shouldAssign: boolean
  ) => {
    const currentStationNames = feedToStationsMapRef.current.get(feedId) || [];
    const nextStationNames = shouldAssign
      ? orderStationNames([...currentStationNames, stationName], stationsRef.current)
      : currentStationNames.filter((name) => name !== stationName);

    if (areStringArraysEqual(nextStationNames, currentStationNames)) return;

    const currentStation = stationsRef.current.find((station) => station.name === stationName);
    if (!currentStation) return;

    const nextStation = {
      ...currentStation,
      feedIds: shouldAssign
        ? [...currentStation.feedIds, feedId]
        : currentStation.feedIds.filter((currentFeedId) => currentFeedId !== feedId),
    };

    setStationEditState((current) => (
      current && current.feedId === feedId
        ? { ...current, draftStationNames: nextStationNames }
        : current
    ));
    setStations((current) => current.map((station) => (
      station.name === stationName ? nextStation : station
    )));
    setFeedToStationsMap((current) => {
      const next = new Map(current);
      if (nextStationNames.length === 0) {
        next.delete(feedId);
      } else {
        next.set(feedId, nextStationNames);
      }
      return next;
    });
    setFeeds((current) => current.map((feed) => (
      feed.id === feedId
        ? { ...feed, tags: nextStationNames }
        : feed
    )));

    try {
      if (shouldAssign) {
        await tagsManager.addTagToFeed(feedId, stationName);
      } else {
        await tagsManager.removeTagFromFeed(feedId, stationName);
      }

      feedLibraryMutationBus.publishFeedPatched(feedId, { tags: nextStationNames });
      feedLibraryMutationBus.publishStationPatched(stationName, {
        name: nextStation.name,
        emoji: nextStation.emoji,
        feedIds: nextStation.feedIds,
        createdAt: nextStation.createdAt,
        sortOrder: nextStation.sortOrder,
      });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update feed stations.';
      appToastService.show(message);
      void loadData();
    }
  }, [feedToStationsMapRef, loadData, stationsRef]);

  useEffect(() => {
    if (!stationEditState) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (stationEditState.anchorEl.contains(target)) return;
      if (stationMenuRef.current?.contains(target)) return;
      setStationEditState(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [stationEditState]);

  useEffect(() => {
    if (!stationEditState) return;

    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 1000,
      handler: (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key !== 'Escape') return;

        event.preventDefault();
        event.stopPropagation();
        setStationEditState(null);
      },
    });
  }, [stationEditState]);

  const commitStationNameEdit = useCallback(async (state: StationNameEditState) => {
    const nextName = state.draftName.trim();
    const commitKey = `${state.originalName}::${nextName}`;
    if (stationNameCommitKeyRef.current === commitKey) {
      return;
    }

    stationNameCommitKeyRef.current = commitKey;
    setStationNameEditState(null);

    if (!nextName || nextName === state.originalName) {
      stationNameCommitKeyRef.current = null;
      return;
    }

    try {
      await tagsManager.renameTag(state.originalName, nextName);
      const previousStation = stationsRef.current.find((station) => station.name === state.originalName);
      const affectedFeedIds = previousStation?.feedIds ?? [];

      setStations((current) =>
        current.map((station) =>
          station.name === state.originalName
            ? { ...station, name: nextName }
            : station
        )
      );
      setFeeds((current) => current.map((feed) => (
        affectedFeedIds.includes(feed.id)
          ? {
            ...feed,
            tags: feed.tags.map((tagName) => (
              tagName === state.originalName ? nextName : tagName
            )),
          }
          : feed
      )));
      setFeedToStationsMap((current) => {
        if (affectedFeedIds.length === 0) {
          return current;
        }

        const next = new Map(current);
        for (const feedId of affectedFeedIds) {
          const stationNames = next.get(feedId);
          if (!stationNames) continue;

          next.set(feedId, stationNames.map((stationName) => (
            stationName === state.originalName ? nextName : stationName
          )));
        }
        return next;
      });
      if (previousStation) {
        feedLibraryMutationBus.publishStationPatched(state.originalName, {
          name: nextName,
          emoji: previousStation.emoji,
          feedIds: previousStation.feedIds,
          createdAt: previousStation.createdAt,
          sortOrder: previousStation.sortOrder,
        });
      }
      setActiveEmojiTarget((current) => (
        current?.kind === 'station' && current.id === state.originalName
          ? { ...current, id: nextName }
          : current
      ));
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to rename station.';
      appToastService.show(message);
      void loadData();
    } finally {
      if (stationNameCommitKeyRef.current === commitKey) {
        stationNameCommitKeyRef.current = null;
      }
    }
  }, [loadData, stationsRef]);

  const persistLibraryItems = useCallback(async (orderedItems: LibraryItemRow[]) => {
    setLibraryItems(orderedItems);

    const nextSmartViews = orderedItems.map(({ id, visible }, index) => ({
      id,
      visible,
      sortOrder: index,
    }));

    try {
      await settingsManager.setSmartViews(nextSmartViews);
      feedLibraryMutationBus.publishSmartViewsPatched(nextSmartViews);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to save library item settings.';
      appToastService.show(message);
      void loadData();
    }
  }, [loadData]);

  const persistStationOrder = useCallback(async (orderedStations: Tag[]) => {
    const nextStations = orderedStations.map((station, index) => ({
      ...station,
      sortOrder: index,
    }));
    setStations(nextStations);

    try {
      const stationUpdates = nextStations.map((station, index) => ({
        station,
        sortOrder: index,
      }));

      await Promise.all(stationUpdates.map(({ station, sortOrder }) => tagsManager.updateTag(station.name, { sortOrder })));
      feedLibraryMutationBus.publishStationsReordered(
        stationUpdates.map(({ station, sortOrder }) => ({
          name: station.name,
          sortOrder,
        }))
      );
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to save station order.';
      appToastService.show(message);
      void loadData();
    }
  }, [loadData]);

  const getNextSortDirection = (direction: FeedSortDirection): FeedSortDirection => {
    if (direction === 'desc') return 'asc';
    if (direction === 'asc') return 'none';
    return 'desc';
  };

  const getSortDirection = (field: FeedSortField): FeedSortDirection => {
    if (sortConfig.field !== field) return 'none';
    return sortConfig.direction;
  };

  const toggleSort = (field: FeedSortField) => {
    setSortConfig((current) => {
      if (current.field === field) {
        return { field, direction: getNextSortDirection(current.direction) };
      }
      return { field, direction: 'desc' };
    });
  };

  const stationRows = useMemo<StationEditRow[]>(
    () =>
      stations.map((station) => ({
        station,
        feedCount: station.feedIds.length,
      })),
    [stations]
  );

  const feedRows = useMemo<FeedEditRow[]>(() => {
    const orderedFeeds = [...feeds];
    const stationSortValueByFeedId = new Map<string, string>();

    for (const feed of feeds) {
      const stationNames = feedToStationsMap.get(feed.id) || [];
      const sortValue = [...stationNames].sort((x, y) => x.localeCompare(y)).join(', ');
      stationSortValueByFeedId.set(feed.id, sortValue);
    }

    if (sortConfig.direction !== 'none') {
      orderedFeeds.sort((a, b) => {
        const getComparison = (): number => {
          switch (sortConfig.field) {
            case 'title':
              return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
            case 'status':
              return (a.consecutiveFailures ?? 0) - (b.consecutiveFailures ?? 0);
            case 'articleCount':
              return (a.articleCount ?? 0) - (b.articleCount ?? 0);
            case 'station':
              return (stationSortValueByFeedId.get(a.id) || '').localeCompare(stationSortValueByFeedId.get(b.id) || '', undefined, {
                sensitivity: 'base',
              });
            case 'subscribedTime':
              return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
          }
        };

        const comparison = getComparison();
        if (comparison !== 0) {
          return sortConfig.direction === 'desc' ? -comparison : comparison;
        }

        return a.title.localeCompare(b.title);
      });
    }

    return orderedFeeds.map((feed) => ({
      feed,
      stationNames: feedToStationsMap.get(feed.id) || [],
    }));
  }, [feedToStationsMap, feeds, sortConfig]);

  const feedCountText = pluralize(feeds.length, 'feed');
  const stationCountText = pluralize(stationRows.length, 'station');
  const libraryCountText = pluralize(libraryItems.length, 'item');
  const activeSearchQuery = isSearchOpen ? searchQuery.trim().toLocaleLowerCase() : '';
  const matchedFeedIds = useMemo(() => {
    if (!activeSearchQuery) return [];

    return feedRows
      .filter(({ feed }) => {
        const searchableText = `${feed.title}\n${feed.url}`.toLocaleLowerCase();
        return searchableText.includes(activeSearchQuery);
      })
      .map(({ feed }) => feed.id);
  }, [activeSearchQuery, feedRows]);
  const matchedFeedIdSet = useMemo(() => new Set(matchedFeedIds), [matchedFeedIds]);
  const firstMatchedFeedId = matchedFeedIds[0] ?? null;
  const feedTableWidth = (
    columnWidths.emoji
    + columnWidths.favicon
    + columnWidths.title
    + columnWidths.url
    + columnWidths.status
    + columnWidths.articleCount
    + columnWidths.station
    + columnWidths.subscribedTime
    + FEED_EDIT_ACTION_COLUMN_WIDTH
  );
  useEffect(() => {
    if (!feedEditTarget || isLoading) return;

    const resolveTargetRow = (target: FeedEditTarget): HTMLTableRowElement | undefined => {
      if (target.kind === 'feed') {
        return rowRefs.current.get(target.id);
      }
      if (target.kind === 'station') {
        return stationRowRefs.current.get(target.id);
      }
      return libraryRowRefs.current.get(target.id);
    };

    const targetRow = resolveTargetRow(feedEditTarget);
    const scrollContainer = scrollContainerRef.current;
    if (!targetRow || !scrollContainer) return;

    const targetScrollTop = getCenteredScrollTop(scrollContainer, targetRow);
    const cancelScroll = animateScrollTop(scrollContainer, targetScrollTop, () => {
      flashFeedEditRow(targetRow);
      clearFeedEditTarget();
    });

    return () => {
      cancelScroll();
    };
  }, [clearFeedEditTarget, feedEditTarget, feedRows.length, isLoading, libraryItems.length, stationRows.length]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((previous) => !previous);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  useEffect(() => {
    return keybindingService.register({
      type: 'keydown',
      priority: 18,
      handler: (event: KeyboardEvent) => {
        if (isArticleListSearchShortcut(event)) {
          event.preventDefault();
          if (feeds.length === 0) return;

          setIsSearchOpen(true);

          requestAnimationFrame(() => {
            const input = document.querySelector('.feed-edit-view .article-list-search-input') as HTMLInputElement | null;
            input?.focus();
            input?.select();
          });
          return;
        }

        if (isCloseOnEscapeShortcut(event) && isSearchOpen) {
          event.preventDefault();
          setIsSearchOpen(false);
          setSearchQuery('');
        }
      },
    });
  }, [feeds.length, isSearchOpen]);

  useEffect(() => {
    if (!firstMatchedFeedId) return;

    const targetRow = rowRefs.current.get(firstMatchedFeedId);
    const scrollContainer = scrollContainerRef.current;
    if (!targetRow || !scrollContainer) return;

    const targetScrollTop = getCenteredScrollTop(scrollContainer, targetRow);
    return animateScrollTop(scrollContainer, targetScrollTop, () => {});
  }, [firstMatchedFeedId]);

  const renderSortIcon = (direction: FeedSortDirection) => {
    if (direction === 'desc') {
      return (
        <svg viewBox="0 0 12 12" className="feed-edit-sort-icon" aria-hidden="true">
          <path d="M6 9L2.5 5h7L6 9z" />
        </svg>
      );
    }
    if (direction === 'asc') {
      return (
        <svg viewBox="0 0 12 12" className="feed-edit-sort-icon" aria-hidden="true">
          <path d="M6 3l3.5 4h-7L6 3z" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 12 12" className="feed-edit-sort-icon" aria-hidden="true">
        <path d="M2.5 6h7v1h-7z" />
      </svg>
    );
  };

  const getSortLabel = (field: FeedSortField, label: string): string => {
    const direction = getSortDirection(field);
    if (direction === 'desc') return `Sorted by ${label} descending`;
    if (direction === 'asc') return `Sorted by ${label} ascending`;
    return 'No feed sorting applied';
  };

  const renderSortableHeader = (field: FeedSortField, label: string) => {
    const direction = getSortDirection(field);
    const sortLabel = getSortLabel(field, label.toLowerCase());

    return (
      <span className="feed-edit-sort-header">
        <span>{label}</span>
        <button
          type="button"
          className="feed-edit-sort-button"
          onClick={() => toggleSort(field)}
          title={sortLabel}
          aria-label={`${sortLabel}. Toggle sort state`}
        >
          {renderSortIcon(direction)}
        </button>
      </span>
    );
  };

  const renderResizeHandle = (column: FeedColumnKey, label: string) => (
    <button
      type="button"
      className={`feed-edit-col-resize-handle ${activeResizeColumn === column ? 'is-active' : ''}`}
      onMouseDown={(event) => startColumnResize(event, column)}
      aria-label={`Resize ${label} column`}
      title={`Resize ${label} column`}
    />
  );

  const getDragRowRefs = useCallback((group: DragGroup) => (
    group === 'library' ? libraryRowRefs.current : stationRowRefs.current
  ), []);

  const clearDragRowPlacement = useCallback((row: HTMLTableRowElement | null) => {
    if (!row) return;
    row.classList.remove('is-drop-before', 'is-drop-after');
  }, []);

  // Keep drag hover feedback imperative so only the affected rows update while dragging.
  const applyDragState = useCallback((nextDragState: DragState | null) => {
    const previousDragState = dragStateRef.current;
    if (previousDragState) {
      const previousRows = getDragRowRefs(previousDragState.group);
      previousRows.get(previousDragState.id)?.classList.remove('is-dragging');
      clearDragRowPlacement(previousRows.get(previousDragState.overId ?? '') ?? null);
    }

    dragStateRef.current = nextDragState;
    if (!nextDragState) return;

    const nextRows = getDragRowRefs(nextDragState.group);
    nextRows.get(nextDragState.id)?.classList.add('is-dragging');

    const overRow = nextRows.get(nextDragState.overId ?? '');
    if (!overRow) return;
    overRow.classList.add(nextDragState.placement === 'after' ? 'is-drop-after' : 'is-drop-before');
  }, [clearDragRowPlacement, getDragRowRefs]);

  const handleDragStart = useCallback((group: DragGroup, id: string, event: React.DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${group}:${id}`);
    applyDragState({
      group,
      id,
      overId: id,
      placement: 'before',
    });
  }, [applyDragState]);

  const handleDragEnd = useCallback(() => {
    applyDragState(null);
  }, [applyDragState]);

  const handleDragOver = useCallback((group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState || currentDragState.group !== group || currentDragState.id === targetId) {
      return;
    }

    event.preventDefault();
    const rowRect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY >= rowRect.top + rowRect.height / 2 ? 'after' : 'before';

    if (currentDragState.overId === targetId && currentDragState.placement === placement) {
      return;
    }

    applyDragState({
      ...currentDragState,
      overId: targetId,
      placement,
    });
  }, [applyDragState]);

  const handleDrop = useCallback(async (group: DragGroup, targetId: string, event: React.DragEvent<HTMLTableRowElement>) => {
    event.preventDefault();

    const currentDragState = dragStateRef.current;
    if (!currentDragState || currentDragState.group !== group || currentDragState.id === targetId) {
      applyDragState(null);
      return;
    }

    const placement = currentDragState.overId === targetId ? currentDragState.placement : 'before';
    applyDragState(null);

    if (group === 'library') {
      const reorderedLibraryItems = reorderList(libraryItemsRef.current, currentDragState.id, targetId, placement, (item) => item.id);
      await persistLibraryItems(reorderedLibraryItems);
      return;
    }

    if (group === 'station') {
      const reorderedStations = reorderList(stationsRef.current, currentDragState.id, targetId, placement, (station) => station.name);
      await persistStationOrder(reorderedStations);
      return;
    }

  }, [applyDragState, libraryItemsRef, persistLibraryItems, persistStationOrder, stationsRef]);

  const handleImportFeeds = async () => {
    setIsOpmlActionLoading(true);
    try {
      const selectedFile = await openOpmlFileForImport();
      if (!selectedFile) {
        return;
      }

      const importResult = await importOpmlTextIntoLibrary(selectedFile.opmlText, {
        refreshTotalFeeds,
        notifyFeedLibraryChanged,
        fileName: selectedFile.fileName,
      });
      await navigateAfterOpmlImport(importResult, { selectFeed, selectTag });
      showOpmlActionMessage(formatOpmlImportSummary(importResult.summary));
    } catch (importError) {
      showOpmlActionMessage(importError instanceof Error ? importError.message : 'Failed to import OPML file.');
    } finally {
      setIsOpmlActionLoading(false);
    }
  };

  const handleExportAllFeeds = async () => {
    if (!window.electronAPI?.saveOpmlFile) {
      showOpmlActionMessage('Export is only available in the desktop app.');
      return;
    }

    setIsOpmlActionLoading(true);
    try {
      const opmlText = await opmlExportService.buildOpmlText();
      const saveResult = await window.electronAPI.saveOpmlFile(opmlText, 'Feeds.opml');
      if (saveResult.canceled) return;
      showOpmlActionMessage('Exported feeds to OPML successfully.');
    } catch (exportError) {
      showOpmlActionMessage(exportError instanceof Error ? exportError.message : 'Failed to export OPML file.');
    } finally {
      setIsOpmlActionLoading(false);
    }
  };

  const handleConfirmDeleteFeed = async () => {
    if (!feedToDelete || isFeedDeleteActionLoading) return;

    setIsFeedDeleteActionLoading(true);
    try {
      const targetFeedId = feedToDelete.id;
      const isDeletingSelectedFeed = selectedFeedId === targetFeedId;
      const affectedStations = stationsRef.current.filter((station) => station.feedIds.includes(targetFeedId));

      await articlesManager.deleteArticlesByFeed(targetFeedId);
      await feedsManager.deleteFeed(targetFeedId);

      if (isDeletingSelectedFeed) {
        clearFeedSelection();
      }

      setFeeds((current) => current.filter((feed) => feed.id !== targetFeedId));
      setStations((current) => current.map((station) => {
        if (!station.feedIds.includes(targetFeedId)) {
          return station;
        }

        return {
          ...station,
          feedIds: station.feedIds.filter((feedId) => feedId !== targetFeedId),
        };
      }));
      setFeedToStationsMap((current) => {
        const next = new Map(current);
        next.delete(targetFeedId);
        return next;
      });
      if (titleEditState?.feedId === targetFeedId) {
        setTitleEditState(null);
      }
      if (urlEditState?.feedId === targetFeedId) {
        setUrlEditState(null);
      }
      if (stationEditState?.feedId === targetFeedId) {
        setStationEditState(null);
      }
      if (emojiMenuState?.kind === 'feed' && emojiMenuState.id === targetFeedId) {
        setEmojiMenuState(null);
      }
      if (activeEmojiTarget?.kind === 'feed' && activeEmojiTarget.id === targetFeedId) {
        setActiveEmojiTarget(null);
      }

      for (const station of affectedStations) {
        feedLibraryMutationBus.publishStationPatched(station.name, {
          ...station,
          feedIds: station.feedIds.filter((feedId) => feedId !== targetFeedId),
        });
      }
      feedLibraryMutationBus.publishFeedDeleted(targetFeedId);
      setFeedToDelete(null);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete feed.';
      appToastService.show(message);
      void loadData();
    } finally {
      setIsFeedDeleteActionLoading(false);
    }
  };

  const handleConfirmDeleteStation = async () => {
    if (!stationToDelete || isStationDeleteActionLoading) return;

    setIsStationDeleteActionLoading(true);
    try {
      const targetStationName = stationToDelete.name;
      const deletedStation = stationsRef.current.find((station) => station.name === targetStationName);
      const affectedFeedIds = deletedStation?.feedIds ?? [];

      await tagsManager.deleteTag(targetStationName);

      setStations((current) => current.filter((station) => station.name !== targetStationName));
      setFeeds((current) => current.map((feed) => {
        if (!feed.tags.includes(targetStationName)) {
          return feed;
        }

        return {
          ...feed,
          tags: feed.tags.filter((stationName) => stationName !== targetStationName),
        };
      }));
      setFeedToStationsMap((current) => {
        if (affectedFeedIds.length === 0) {
          return current;
        }

        const next = new Map(current);
        for (const feedId of affectedFeedIds) {
          const stationNames = next.get(feedId);
          if (!stationNames) continue;

          const filteredNames = stationNames.filter((stationName) => stationName !== targetStationName);
          if (filteredNames.length === 0) {
            next.delete(feedId);
            continue;
          }

          next.set(feedId, filteredNames);
        }
        return next;
      });
      if (stationNameEditState?.stationName === targetStationName) {
        setStationNameEditState(null);
      }
      if (stationEditState) {
        setStationEditState(null);
      }
      if (emojiMenuState?.kind === 'station' && emojiMenuState.id === targetStationName) {
        setEmojiMenuState(null);
      }
      if (activeEmojiTarget?.kind === 'station' && activeEmojiTarget.id === targetStationName) {
        setActiveEmojiTarget(null);
      }

      feedLibraryMutationBus.publishStationDeleted(
        deletedStation?.name ?? targetStationName,
        affectedFeedIds
      );
      setStationToDelete(null);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete station.';
      appToastService.show(message);
      void loadData();
    } finally {
      setIsStationDeleteActionLoading(false);
    }
  };

  const handleDeleteStationWithFeeds = async () => {
    if (!stationToDelete || isStationDeleteActionLoading) return;

    setIsStationDeleteActionLoading(true);
    try {
      const targetStationName = stationToDelete.name;
      const deletedStation = stationsRef.current.find((station) => station.name === targetStationName);
      const affectedFeedIds = deletedStation?.feedIds ?? [];
      const feedsToDelete: string[] = [];
      const feedsToUnlink: string[] = [];

      for (const feedId of affectedFeedIds) {
        const feed = feedsRef.current.find((entry) => entry.id === feedId);
        if (!feed) {
          feedsToDelete.push(feedId);
          continue;
        }

        const hasOtherStations = feed.tags.some((stationName) => stationName !== targetStationName);
        if (hasOtherStations) {
          feedsToUnlink.push(feedId);
        } else {
          feedsToDelete.push(feedId);
        }
      }

      const deletedFeedIdSet = new Set(feedsToDelete);

      for (const feedId of feedsToDelete) {
        await articlesManager.deleteArticlesByFeed(feedId);
        await feedsManager.deleteFeed(feedId);

        if (selectedFeedId === feedId) {
          clearFeedSelection();
        }
      }

      await tagsManager.deleteTag(targetStationName);

      setStations((current) => current
        .filter((station) => station.name !== targetStationName)
        .map((station) => ({
          ...station,
          feedIds: station.feedIds.filter((feedId) => !deletedFeedIdSet.has(feedId)),
        })));
      setFeeds((current) => current
        .filter((feed) => !deletedFeedIdSet.has(feed.id))
        .map((feed) => {
          if (!feed.tags.includes(targetStationName)) {
            return feed;
          }

          return {
            ...feed,
            tags: feed.tags.filter((stationName) => stationName !== targetStationName),
          };
        }));
      setFeedToStationsMap((current) => {
        const next = new Map(current);

        for (const feedId of feedsToDelete) {
          next.delete(feedId);
        }

        for (const feedId of feedsToUnlink) {
          const stationNames = next.get(feedId);
          if (!stationNames) continue;

          const filteredNames = stationNames.filter((stationName) => stationName !== targetStationName);
          if (filteredNames.length === 0) {
            next.delete(feedId);
            continue;
          }

          next.set(feedId, filteredNames);
        }

        return next;
      });

      for (const feedId of feedsToDelete) {
        if (titleEditState?.feedId === feedId) {
          setTitleEditState(null);
        }
        if (urlEditState?.feedId === feedId) {
          setUrlEditState(null);
        }
        if (stationEditState?.feedId === feedId) {
          setStationEditState(null);
        }
        if (emojiMenuState?.kind === 'feed' && emojiMenuState.id === feedId) {
          setEmojiMenuState(null);
        }
        if (activeEmojiTarget?.kind === 'feed' && activeEmojiTarget.id === feedId) {
          setActiveEmojiTarget(null);
        }

        const affectedStations = stationsRef.current.filter(
          (station) => station.feedIds.includes(feedId) && station.name !== targetStationName,
        );
        for (const station of affectedStations) {
          feedLibraryMutationBus.publishStationPatched(station.name, {
            ...station,
            feedIds: station.feedIds.filter((id) => id !== feedId),
          });
        }

        feedLibraryMutationBus.publishFeedDeleted(feedId);
      }

      if (stationNameEditState?.stationName === targetStationName) {
        setStationNameEditState(null);
      }
      if (stationEditState) {
        setStationEditState(null);
      }
      if (emojiMenuState?.kind === 'station' && emojiMenuState.id === targetStationName) {
        setEmojiMenuState(null);
      }
      if (activeEmojiTarget?.kind === 'station' && activeEmojiTarget.id === targetStationName) {
        setActiveEmojiTarget(null);
      }

      feedLibraryMutationBus.publishStationDeleted(
        deletedStation?.name ?? targetStationName,
        affectedFeedIds,
      );
      setStationToDelete(null);
    } catch (deleteError) {
      const message = deleteError instanceof Error
        ? deleteError.message
        : 'Failed to delete station and feeds.';
      appToastService.show(message);
      void loadData();
    } finally {
      setIsStationDeleteActionLoading(false);
    }
  };

  const selectedEmoji = useMemo(() => {
    if (!emojiMenuState) return undefined;

    if (emojiMenuState.kind === 'feed') {
      return feeds.find((feed) => feed.id === emojiMenuState.id)?.emoji;
    }

    return stations.find((station) => station.name === emojiMenuState.id)?.emoji;
  }, [emojiMenuState, feeds, stations]);

  const attachFeedRowRef = useCallback((feedId: string, node: HTMLTableRowElement | null) => {
    if (node) {
      rowRefs.current.set(feedId, node);
      return;
    }

    rowRefs.current.delete(feedId);
  }, []);

  const attachStationRowRef = useCallback((stationName: string, node: HTMLTableRowElement | null) => {
    if (node) {
      stationRowRefs.current.set(stationName, node);
      return;
    }

    stationRowRefs.current.delete(stationName);
  }, []);

  const attachLibraryRowRef = useCallback((itemId: string, node: HTMLTableRowElement | null) => {
    if (node) {
      libraryRowRefs.current.set(itemId, node);
      return;
    }

    libraryRowRefs.current.delete(itemId);
  }, []);

  const updateTitleDraft = useCallback((feedId: string, draftTitle: string) => {
    setTitleEditState((current) =>
      current && current.feedId === feedId
        ? { ...current, draftTitle }
        : current
    );
  }, []);

  const updateUrlDraft = useCallback((feedId: string, draftUrl: string) => {
    setUrlEditState((current) =>
      current && current.feedId === feedId
        ? { ...current, draftUrl }
        : current
    );
  }, []);

  const toggleStationDraft = useCallback((feedId: string, stationName: string) => {
    const currentStationNames = feedToStationsMapRef.current.get(feedId) || [];
    const shouldAssign = !currentStationNames.includes(stationName);
    void applyStationSelection(feedId, stationName, shouldAssign);
  }, [applyStationSelection, feedToStationsMapRef]);

  const updateStationNameDraft = useCallback((stationName: string, draftName: string) => {
    setStationNameEditState((current) =>
      current && current.stationName === stationName
        ? { ...current, draftName }
        : current
    );
  }, []);

  const requestDeleteFeed = useCallback((feed: Feed) => {
    setFeedToDelete({ id: feed.id, title: feed.title });
  }, []);

  const requestDeleteStation = useCallback((stationName: string) => {
    setStationToDelete({ name: stationName });
  }, []);

  const toggleLibraryItemVisibility = useCallback((viewId: SmartViewId) => {
    const nextItems = libraryItemsRef.current.map((item) => (
      item.id === viewId
        ? { ...item, visible: !item.visible }
        : item
    ));
    void persistLibraryItems(nextItems);
  }, [libraryItemsRef, persistLibraryItems]);

  const stationOptionNames = useMemo(
    () => stations.map((station) => station.name),
    [stations]
  );

  return (
    <div className="article-list feed-edit-view">
      <FeedEditWidgets
        onToggleSearch={handleToggleSearch}
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onCloseSearch={handleCloseSearch}
        onExportAllFeeds={() => { void handleExportAllFeeds(); }}
        onImportFeeds={() => { void handleImportFeeds(); }}
        isSearchDisabled={feeds.length === 0}
        disabled={isOpmlActionLoading}
      />
      <div ref={scrollContainerRef} className="article-list-items feed-edit-groups-scroll">
        <section className="feed-edit-group" data-section="feed-edit-library-group">
          <div className="feed-edit-group-header">
            <div className="article-list-title-content">
              <h3 className="feed-edit-group-title">Library</h3>
              <p className="feed-edit-group-subtitle">{libraryCountText}</p>
            </div>
          </div>
          <div className="feed-edit-group-body">
            <div className="article-list-title-content feed-edit-group-body-content">
              {isLoading ? (
                <div className="feed-edit-empty-state theme-text-secondary">Loading library items...</div>
              ) : error ? (
                <div className="feed-edit-empty-state theme-text-danger">{error}</div>
              ) : libraryItems.length === 0 ? (
                <div className="feed-edit-empty-state theme-text-secondary">No library items.</div>
              ) : (
                <FeedEditTableViewport
                  header={(
                    <tr>
                      <th className="feed-edit-drag-col" aria-label="Drag" />
                      <th>Library item</th>
                      <th className="feed-edit-visibility-col">Action</th>
                    </tr>
                  )}
                  body={libraryItems.map((item) => (
                    <FeedEditLibraryRow
                      key={item.id}
                      item={item}
                      attachRowRef={attachLibraryRowRef}
                      onRowDragStart={handleDragStart}
                      onRowDragEnd={handleDragEnd}
                      onRowDragOver={handleDragOver}
                      onRowDrop={handleDrop}
                      onToggleVisibility={toggleLibraryItemVisibility}
                    />
                  ))}
                />
              )}
            </div>
          </div>
        </section>

        <section className="feed-edit-group" data-section="feed-edit-stations-group">
          <div className="feed-edit-group-header">
            <div className="article-list-title-content feed-edit-group-header-content">
              <div className="feed-edit-group-heading">
                <h3 className="feed-edit-group-title">Stations</h3>
                <p className="feed-edit-group-subtitle">{stationCountText}</p>
              </div>
              <div className="feed-edit-group-actions has-no-drag">
                <button
                  type="button"
                  className="button is-text is-small article-view-action-button article-list-widget-button"
                  onClick={() => { void handleAddStation(); }}
                  aria-label={TOOLTIPS.feedEdit.addStation}
                  title={TOOLTIPS.feedEdit.addStation}
                  data-widget="add-station"
                >
                  <span className="icon">
                    <AddIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div className="feed-edit-group-body">
            <div className="article-list-title-content feed-edit-group-body-content">
              {isLoading ? (
                <div className="feed-edit-empty-state theme-text-secondary">Loading stations...</div>
              ) : error ? (
                <div className="feed-edit-empty-state theme-text-danger">{error}</div>
              ) : stationRows.length === 0 ? (
                <div className="feed-edit-empty-state theme-text-secondary">No stations yet.</div>
              ) : (
                <FeedEditTableViewport
                  colgroup={(
                    <colgroup>
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.drag}px` }} />
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.emoji}px` }} />
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.name}px` }} />
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.feedCount}px` }} />
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.createdAt}px` }} />
                      <col style={{ width: `${STATION_TABLE_COLUMN_WIDTHS.action}px` }} />
                    </colgroup>
                  )}
                  header={(
                    <tr>
                      <th className="feed-edit-drag-col" aria-label="Drag" />
                      <th>Emoji</th>
                      <th>Name</th>
                      <th>Feed counts</th>
                      <th>Created date</th>
                      <th className="feed-edit-action-col">Action</th>
                    </tr>
                  )}
                  body={stationRows.map(({ station, feedCount }) => (
                    <FeedEditStationRow
                      key={station.name}
                      station={station}
                      feedCount={feedCount}
                      attachRowRef={attachStationRowRef}
                      stationNameEditState={stationNameEditState?.stationName === station.name ? stationNameEditState : null}
                      onRowDragStart={handleDragStart}
                      onRowDragEnd={handleDragEnd}
                      onRowDragOver={handleDragOver}
                      onRowDrop={handleDrop}
                      onEmojiButtonClick={handleEmojiButtonClick}
                      isEmojiButtonActive={activeEmojiTarget?.kind === 'station' && activeEmojiTarget.id === station.name}
                      onStartStationNameEdit={startStationNameEdit}
                      onUpdateStationNameDraft={updateStationNameDraft}
                      onCommitStationNameEdit={commitStationNameEdit}
                      onRequestDelete={requestDeleteStation}
                    />
                  ))}
                />
              )}
            </div>
          </div>
        </section>

        <section className="feed-edit-group" data-section="feed-edit-feeds-group">
          <div className="feed-edit-group-header">
            <div className="article-list-title-content">
              <h3 className="feed-edit-group-title">Feeds</h3>
              <p className="feed-edit-group-subtitle">{feedCountText}</p>
            </div>
          </div>
          <div className="feed-edit-group-body">
            <div className="article-list-title-content feed-edit-group-body-content">
              {isLoading ? (
                <div className="feed-edit-empty-state theme-text-secondary">Loading feeds...</div>
              ) : error ? (
                <div className="feed-edit-empty-state theme-text-danger">{error}</div>
              ) : feedRows.length === 0 ? (
                <div className="feed-edit-empty-state theme-text-secondary">No feeds yet.</div>
              ) : (
                <FeedEditTableViewport
                  section="feed-edit-table"
                  tableWidth={feedTableWidth}
                  colgroup={(
                    <colgroup>
                      <col style={{ width: `${columnWidths.emoji}px` }} />
                      <col style={{ width: `${columnWidths.favicon}px` }} />
                      <col style={{ width: `${columnWidths.title}px` }} />
                      <col style={{ width: `${columnWidths.station}px` }} />
                      <col style={{ width: `${columnWidths.url}px` }} />
                      <col style={{ width: `${columnWidths.status}px` }} />
                      <col style={{ width: `${columnWidths.articleCount}px` }} />
                      <col style={{ width: `${columnWidths.subscribedTime}px` }} />
                      <col style={{ width: `${FEED_EDIT_ACTION_COLUMN_WIDTH}px` }} />
                    </colgroup>
                  )}
                  header={(
                    <tr>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">Emoji</div>
                        {renderResizeHandle('emoji', 'Emoji')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">Favicon</div>
                        {renderResizeHandle('favicon', 'Favicon')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">{renderSortableHeader('title', 'Title')}</div>
                        {renderResizeHandle('title', 'Title')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">{renderSortableHeader('station', 'Stations')}</div>
                        {renderResizeHandle('station', 'Stations')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">URL</div>
                        {renderResizeHandle('url', 'URL')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">{renderSortableHeader('status', 'Status')}</div>
                        {renderResizeHandle('status', 'Status')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">{renderSortableHeader('articleCount', 'Article counts')}</div>
                        {renderResizeHandle('articleCount', 'Article counts')}
                      </th>
                      <th className="feed-edit-th-resizable">
                        <div className="feed-edit-th-content">{renderSortableHeader('subscribedTime', 'Created date')}</div>
                        {renderResizeHandle('subscribedTime', 'Created date')}
                      </th>
                      <th className="feed-edit-action-header feed-edit-action-col">Actions</th>
                    </tr>
                  )}
                  body={feedRows.map(({ feed, stationNames }) => (
                    <FeedEditFeedRow
                      key={feed.id}
                      feed={feed}
                      stationNames={stationNames}
                      isSearchMatch={matchedFeedIdSet.has(feed.id)}
                      isCurrentSearchMatch={firstMatchedFeedId === feed.id}
                      titleEditState={titleEditState?.feedId === feed.id ? titleEditState : null}
                      urlEditState={urlEditState?.feedId === feed.id ? urlEditState : null}
                      stationEditState={stationEditState?.feedId === feed.id ? stationEditState : null}
                      stationOptions={stationOptionNames}
                      stationMenuRef={stationMenuRef}
                      attachRowRef={attachFeedRowRef}
                      onEmojiButtonClick={handleEmojiButtonClick}
                      isEmojiButtonActive={activeEmojiTarget?.kind === 'feed' && activeEmojiTarget.id === feed.id}
                      onStartTitleEdit={startTitleEdit}
                      onUpdateTitleDraft={updateTitleDraft}
                      onCommitTitleEdit={commitTitleEdit}
                      onStartUrlEdit={startUrlEdit}
                      onUpdateUrlDraft={updateUrlDraft}
                      onCommitUrlEdit={commitUrlEdit}
                      onStartStationEdit={startStationEdit}
                      onToggleStationDraft={toggleStationDraft}
                      onRequestDelete={requestDeleteFeed}
                    />
                  ))}
                />
              )}
            </div>
          </div>
        </section>
      </div>
      <EmojiSubmenu
        isOpen={!!emojiMenuState}
        anchorEl={emojiMenuState?.anchorEl || null}
        position="right"
        onEmojiSelect={handleEmojiSelect}
        onClose={() => setEmojiMenuState(null)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
        selectedEmoji={selectedEmoji}
      />
      {opmlActionMessage && (
        <NotificationToast message={opmlActionMessage} />
      )}
      <Modal
        isOpen={!!feedToDelete}
        onClose={() => {
          if (isFeedDeleteActionLoading) return;
          setFeedToDelete(null);
        }}
        maxWidth="460px"
        closeOnBackdrop={!isFeedDeleteActionLoading}
        closeOnEscape={!isFeedDeleteActionLoading}
      >
        <div className="feed-edit-delete-modal">
          <h2 className="add-feed-modal-title">Delete Feed</h2>
          <p className="feed-edit-delete-modal-description">
            Please confirm you want to delete "{feedToDelete?.title}".
          </p>
          <div className="feed-edit-delete-modal-actions">
            <button
              type="button"
              className="modal-confirm-button modal-confirm-button-danger feed-edit-delete-modal-button"
              onClick={() => { void handleConfirmDeleteFeed(); }}
              disabled={isFeedDeleteActionLoading}
            >
              {isFeedDeleteActionLoading ? 'Deleting...' : 'Confirm'}
            </button>
            <button
              type="button"
              className="modal-confirm-button modal-confirm-button-outline feed-edit-delete-modal-button feed-edit-delete-modal-cancel"
              onClick={() => setFeedToDelete(null)}
              disabled={isFeedDeleteActionLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={!!stationToDelete}
        onClose={() => {
          if (isStationDeleteActionLoading) return;
          setStationToDelete(null);
        }}
        maxWidth="460px"
        closeOnBackdrop={!isStationDeleteActionLoading}
        closeOnEscape={!isStationDeleteActionLoading}
      >
        <div className="feed-edit-delete-modal">
          <h2 className="add-feed-modal-title">Delete Station</h2>
          <p className="feed-edit-delete-modal-description">
            Please confirm you want to delete "{stationToDelete?.name}".
          </p>
          <p className="feed-edit-delete-modal-description">
            Feeds in this station will stay in your library and become unstationed.
          </p>
          <p className="feed-edit-delete-modal-description">
            To remove feeds that belong only to this station (and their articles), use Delete Station and Feeds. Feeds shared with other stations are unlinked only.
          </p>
          <div className="feed-edit-delete-modal-actions">
            <button
              type="button"
              className="modal-confirm-button modal-confirm-button-danger feed-edit-delete-modal-button"
              onClick={() => { void handleConfirmDeleteStation(); }}
              disabled={isStationDeleteActionLoading}
            >
              {isStationDeleteActionLoading ? 'Deleting...' : 'Confirm'}
            </button>
            <button
              type="button"
              className="modal-confirm-button modal-confirm-button-danger feed-edit-delete-modal-button"
              onClick={() => { void handleDeleteStationWithFeeds(); }}
              disabled={isStationDeleteActionLoading}
            >
              {isStationDeleteActionLoading ? 'Deleting...' : 'Delete Station and Feeds'}
            </button>
            <button
              type="button"
              className="modal-confirm-button modal-confirm-button-outline feed-edit-delete-modal-button feed-edit-delete-modal-cancel"
              onClick={() => setStationToDelete(null)}
              disabled={isStationDeleteActionLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
