export interface ArticleListAnchorRow {
  index: number;
  start: number;
  end: number;
}

/**
 * Row to hold in place while every row is re-measured (density change).
 * - `viewport`: the active row stays at the same distance from the list top.
 * - `ratio`: the top visible row keeps the same fraction scrolled past.
 */
export type ArticleListScrollAnchor =
  | { index: number; kind: 'viewport'; viewportOffset: number }
  | { index: number; kind: 'ratio'; ratio: number };

export function captureArticleListScrollAnchor(
  rows: readonly ArticleListAnchorRow[],
  scrollTop: number,
  viewportHeight: number,
  activeIndex: number,
): ArticleListScrollAnchor | null {
  const viewportEnd = scrollTop + viewportHeight;
  const activeRow = activeIndex >= 0
    ? rows.find((row) => row.index === activeIndex && row.end > scrollTop && row.start < viewportEnd)
    : undefined;
  if (activeRow) {
    return { index: activeRow.index, kind: 'viewport', viewportOffset: activeRow.start - scrollTop };
  }

  const topRow = rows.find((row) => row.end > scrollTop);
  if (!topRow) return null;
  const size = topRow.end - topRow.start;
  return {
    index: topRow.index,
    kind: 'ratio',
    ratio: size > 0 ? Math.min(1, Math.max(0, (scrollTop - topRow.start) / size)) : 0,
  };
}

/** scrollTop that puts the anchor row back where it was, given its new start and size. */
export function resolveArticleListAnchorScrollTop(
  anchor: ArticleListScrollAnchor,
  start: number,
  size: number,
): number {
  const target = anchor.kind === 'viewport'
    ? start - anchor.viewportOffset
    : start + anchor.ratio * size;
  return Math.max(0, Math.round(target));
}
