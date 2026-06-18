/**
 * Global application constants
 * These values are not user-configurable
 */

/**
 * Default emoji shown for feeds without a custom emoji or favicon
 */
export const DEFAULT_FEED_EMOJI = '⛅';

// Shared deck/article-view animation timing (milliseconds).
export const DECK_SLIDE_EASE = [0.22, 0.61, 0.36, 1] as const;
export const APP_LAYER_TRANSITION_MS = 260;
export const ARTICLE_LAYER_TRANSITION_MS = 220;
export const ARTICLE_VIEW_OPENING_MS = 240;
export const ARTICLE_VIEW_CLOSE_ANIMATION_MS = APP_LAYER_TRANSITION_MS;

/**
 * Minimum time (ms) between network fetches for the same feed.
 * If a feed was fetched within this window, clicking it again will
 * show stored articles without hitting the network.
 */
export const FEED_FETCH_COOLDOWN_MS = 60_000;

/**
 * Network timeout (ms) for RSS/Atom/JSON feed HTTP fetches.
 * Feed fetch timeout for native HTTP requests (milliseconds).
 */
export const FEED_FETCH_TIMEOUT_MS = 5_000;

/**
 * Minimum time (ms) between favicon refresh attempts for the same feed.
 * Piggybacks on article fetching — if the favicon hasn't been refreshed
 * in over 24 hours, it re-fetches it.
 */
export const FAVICON_REFRESH_COOLDOWN_MS = 24 * 60 * 60_000;

export type SmartViewId = 'saved' | 'unread' | 'all';

export const DEFAULT_SMART_VIEW_DEFINITIONS: Array<{ id: SmartViewId; label: string }> = [
  { id: 'saved', label: 'Saved' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All Items' },
];
