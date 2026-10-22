import {
  MAX_MUTE_RULE_TEXT_LENGTH,
  MAX_MUTE_RULES,
  MUTE_PREVIEW_ARTICLE_LIMIT,
  type MuteRule,
  type MuteRulePreview,
  type MuteRuleScope,
} from '@/types/muteRules';
import { pluralize } from './manageFeedsModel';

/**
 * Pure helpers for the Filters tab (mute words): scope labels, the select encoding,
 * draft validation and the live match hint. Matching itself runs in Rust.
 */

export const createMuteRuleId = (): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `mute-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

export const normalizeMuteText = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** `<select>` value for a scope: `all`, `feed:<id>`, `station:<name>`. */
export const scopeToValue = (scope: MuteRuleScope): string => {
  switch (scope.kind) {
    case 'feed':
      return `feed:${scope.id}`;
    case 'station':
      return `station:${scope.name}`;
    case 'all':
    default:
      return 'all';
  }
};

export const scopeFromValue = (value: string): MuteRuleScope => {
  if (value.startsWith('feed:')) return { kind: 'feed', id: value.slice('feed:'.length) };
  if (value.startsWith('station:')) return { kind: 'station', name: value.slice('station:'.length) };
  return { kind: 'all' };
};

export const describeMuteScope = (
  scope: MuteRuleScope,
  feeds: ReadonlyArray<{ id: string; title: string }>,
): string => {
  switch (scope.kind) {
    case 'feed':
      return feeds.find((feed) => feed.id === scope.id)?.title ?? 'A removed feed';
    case 'station':
      return `Station: ${scope.name}`;
    case 'all':
    default:
      return 'All feeds';
  }
};

export const MUTE_COPY = {
  emptyText: 'Enter a word or phrase.',
  tooLong: `Use ${MAX_MUTE_RULE_TEXT_LENGTH} characters or fewer.`,
  tooMany: `You can have up to ${MAX_MUTE_RULES} mute words.`,
  duplicate: 'This word already has a rule for the same feeds.',
  saveFailed: 'Couldn’t save the rule. Try again.',
  deleteFailed: 'Couldn’t delete the rule. Try again.',
  loadFailed: 'Couldn’t load your mute words. Try again.',
  applyFailed: 'Couldn’t update your articles. Try again.',
} as const;

/** Plain-language problem with a draft, or null when it can be saved. */
export const validateMuteDraft = (
  text: string,
  scope: MuteRuleScope,
  rules: ReadonlyArray<MuteRule>,
  editingId: string | null,
): string | null => {
  const normalized = normalizeMuteText(text);
  if (!normalized) return MUTE_COPY.emptyText;
  if (normalized.length > MAX_MUTE_RULE_TEXT_LENGTH) return MUTE_COPY.tooLong;
  if (!editingId && rules.length >= MAX_MUTE_RULES) return MUTE_COPY.tooMany;
  const key = scopeToValue(scope);
  const lower = normalized.toLocaleLowerCase();
  const duplicate = rules.some((rule) => (
    rule.id !== editingId
    && scopeToValue(rule.scope) === key
    && normalizeMuteText(rule.text).toLocaleLowerCase() === lower
  ));
  return duplicate ? MUTE_COPY.duplicate : null;
};

/** "Would match 3 of the last 500 articles". */
export const formatMutePreview = (preview: MuteRulePreview): string => {
  if (preview.scanned === 0) return 'No articles yet to check against.';
  const window = preview.scanned >= MUTE_PREVIEW_ARTICLE_LIMIT
    ? `the last ${MUTE_PREVIEW_ARTICLE_LIMIT} articles`
    : `your ${pluralize(preview.scanned, 'article')}`;
  if (preview.matched === 0) return `Wouldn’t match any of ${window}.`;
  return `Would match ${preview.matched} of ${window}.`;
};

export const formatMuteApplied = (markedCount: number): string => (
  markedCount === 0
    ? 'No unread articles match your mute words.'
    : `Marked ${pluralize(markedCount, 'article')} as read.`
);
