/**
 * Mute words. Persisted by Rust in `user-settings.json` (`AppSettings::mute_rules`) and
 * matched natively when new articles are stored; keep aligned with
 * `src-tauri/src/feeds/mute.rs`.
 */
export type MuteRuleScope =
  | { kind: 'all' }
  | { kind: 'feed'; id: string }
  | { kind: 'station'; name: string };

/** Only Mark as read for now: articles have no hidden flag to filter on cheaply. */
export type MuteRuleAction = 'mark-read';

export interface MuteRule {
  id: string;
  text: string;
  matchDescription: boolean;
  scope: MuteRuleScope;
  action: MuteRuleAction;
}

export interface MuteRulePreview {
  matched: number;
  scanned: number;
}

export interface MuteApplyResult {
  markedCount: number;
  feeds: Array<{ feedId: string; unreadCount: number; articleCount: number }>;
}

export const MAX_MUTE_RULES = 200;
export const MAX_MUTE_RULE_TEXT_LENGTH = 200;
export const MUTE_PREVIEW_ARTICLE_LIMIT = 500;
