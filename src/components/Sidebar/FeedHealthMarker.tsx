import React from 'react';
import './FeedHealthMarker.css';

/** SF Symbols–style `exclamationmark.circle` (regular weight), drawn here; see settingsIcons. */
const ExclamationCircleGlyph: React.FC = () => (
  <svg
    className="feed-health-marker-glyph"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.4v5.6" />
    <circle cx="12" cy="16.4" r="0.55" fill="currentColor" stroke="none" />
  </svg>
);

interface FeedHealthMarkerProps {
  /** Plain-language reason, e.g. "KiJi couldn’t update this feed for 2 days." */
  message: string;
  onShowInManageFeeds: () => void;
}

/**
 * Quiet "can't update" hint on a sidebar row (secondary color, not an alert). Clicking it is
 * the row's "Show in Manage Feeds" action and reveals the feed there.
 */
export const FeedHealthMarker: React.FC<FeedHealthMarkerProps> = ({ message, onShowInManageFeeds }) => (
  <button
    type="button"
    className="feed-health-marker"
    title={`${message} Click to show it in Manage Feeds.`}
    aria-label={`${message} Show in Manage Feeds`}
    data-component="feed-health-marker"
    data-action="show-in-manage-feeds"
    draggable={false}
    onClick={(event) => {
      event.stopPropagation();
      onShowInManageFeeds();
    }}
  >
    <ExclamationCircleGlyph />
  </button>
);
