import type { ArticleQuery } from '@/types/articleQuery';

export type SourceRefreshIntent = 'switch' | 'manual';

export type SourceRefreshTriggerOptions = {
  forceNetwork?: boolean;
  /** Station switch bypasses failure backoff but still respects the 60s fetch cooldown. */
  bypassBackoff?: boolean;
};

export type FeedSourceRefreshPayload = {
  kind: 'feed';
  token: number;
  sourceKey: string;
  intent: SourceRefreshIntent;
  refreshOptions: SourceRefreshTriggerOptions;
  feedId: string;
  feedQuery: ArticleQuery;
  perfMark?: string;
};

export type TagSourceRefreshPayload = {
  kind: 'tag';
  token: number;
  sourceKey: string;
  intent: SourceRefreshIntent;
  refreshOptions: SourceRefreshTriggerOptions;
  tagName: string;
  feedIds: string[];
  tagQuery: ArticleQuery;
  shouldReset: boolean;
  perfMark?: string;
};

export type SourceSelectionReadyPayload = FeedSourceRefreshPayload | TagSourceRefreshPayload;

export type SourceSelectionAbortReason =
  | 'paint-gate-aborted'
  | 'debounce-aborted'
  | 'selection-changed';
