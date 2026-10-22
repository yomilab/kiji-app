import type { MarkReadScopeRequest } from '@/lib/tauriClient/contracts';
import type { Article } from '@/types/article';

/** The list a Mark All as Read applies to (mirrors FeedContext's source descriptor). */
export type MarkReadSource =
  | { type: 'feed'; feedId: string }
  | { type: 'tag'; tagName: string }
  | { type: 'smart'; viewType: string };

export type MarkReadOlderThanDays = 1 | 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long the Undo toast (and the changed hashes it holds) stays. */
export const MARK_READ_UNDO_WINDOW_MS = 8000;

/**
 * Native scope for a list, or null when the list has nothing to mark (Saved
 * has no read state; Read is already read). Pinned is the `pinned` station.
 */
export function toMarkReadScope(source: MarkReadSource | null | undefined): MarkReadScopeRequest | null {
  if (!source) return null;
  if (source.type === 'feed') return { feedId: source.feedId };
  if (source.type === 'tag') return { tagName: source.tagName };
  if (source.viewType === 'all' || source.viewType === 'unread') return { smartView: source.viewType };
  if (source.viewType === 'pinned') return { tagName: 'pinned' };
  return null;
}

export function canMarkSourceRead(source: MarkReadSource | null | undefined): boolean {
  return toMarkReadScope(source) !== null;
}

export function markReadCutoff(days: MarkReadOlderThanDays, now = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export interface RowReadPatch {
  read: boolean;
  /** Exact rows to change; null patches every row in the scope (by `olderThan`). */
  hashes: ReadonlySet<string> | null;
  olderThan?: string;
}

const rowDate = (article: Article): string => article.publishedDate ?? article.fetchedDate ?? '';

/**
 * Applies a scoped read change to the rows on screen without reloading.
 * Rows stay in place (also in Unread, like NetNewsWire) so Undo can flip them
 * back. Returns the same array when nothing changed.
 */
export function applyRowReadPatch(articles: Article[], patch: RowReadPatch): Article[] {
  let changed = false;
  const next = articles.map((article) => {
    if (article.read === patch.read) return article;
    if (patch.hashes) {
      if (!patch.hashes.has(article.hash)) return article;
    } else if (patch.olderThan !== undefined && !(rowDate(article) < patch.olderThan)) {
      return article;
    }
    changed = true;
    return { ...article, read: patch.read };
  });
  return changed ? next : articles;
}

const plural = (count: number): string => (count === 1 ? 'article' : 'articles');

export function markReadToastText(changed: number, olderThanDays?: MarkReadOlderThanDays): string {
  if (changed === 0) {
    return olderThanDays ? 'No older unread articles' : 'No unread articles';
  }
  return `Marked ${changed.toLocaleString()} ${olderThanDays ? 'older ' : ''}${plural(changed)} as read`;
}
