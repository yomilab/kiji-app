import type { Article } from '@/types/article';
import { mergeUniqueArticlesByHash } from './mergeUniqueArticlesByHash';

/**
 * Background refresh while the window is hidden (KiJi kept running after its
 * window closed) must not grow the visible list for days:
 * - hidden and scrolled to the top → keep just the first page;
 * - hidden and scrolled down → keep the current length (newest win, the
 *   oldest tail drops) so the reading position mostly survives;
 * - visible → unchanged behavior (fresh rows merged ahead of loaded ones).
 */
export interface BackgroundRefreshCapInput {
  hidden: boolean;
  atTop: boolean;
  previousLength: number;
  pageSize: number;
}

/** Rows to ask the database for. */
export function backgroundRefreshQueryCount(input: BackgroundRefreshCapInput): number {
  if (input.hidden && input.atTop) {
    return input.pageSize;
  }
  return Math.max(input.pageSize, input.previousLength);
}

export interface CappedBackgroundList {
  list: Article[];
  pageWasFull: boolean;
}

export function capBackgroundRefreshList(
  fresh: Article[],
  loaded: Article[],
  input: BackgroundRefreshCapInput,
): CappedBackgroundList {
  const merged = mergeUniqueArticlesByHash(fresh, loaded);
  if (!input.hidden) {
    return {
      list: merged,
      pageWasFull: merged.length >= Math.max(input.pageSize, input.previousLength),
    };
  }
  const maxLength = input.atTop
    ? input.pageSize
    : Math.max(input.pageSize, input.previousLength);
  const list = merged.length > maxLength ? merged.slice(0, maxLength) : merged;
  return { list, pageWasFull: list.length >= maxLength };
}

export const isDocumentHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';
