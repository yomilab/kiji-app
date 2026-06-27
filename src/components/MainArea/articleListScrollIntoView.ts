export interface VirtualRowBounds {
  index: number;
  start: number;
  end: number;
}

export function shouldScrollArticleIndexIntoView(
  index: number,
  firstVisibleIndex: number,
  lastVisibleIndex: number,
  padding = 1,
): boolean {
  if (index < 0) {
    return false;
  }
  if (lastVisibleIndex < 0) {
    return index > 0;
  }
  return index < firstVisibleIndex - padding || index > lastVisibleIndex + padding;
}

/** Keyboard focus must track the scroll viewport, not virtualizer overscan. */
export function shouldScrollKeyboardFocusIntoView(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  virtualRows: VirtualRowBounds[],
  edgePadding = 8,
): boolean {
  if (index < 0 || viewportHeight <= 0) {
    return false;
  }

  const viewTop = scrollTop + edgePadding;
  const viewBottom = scrollTop + viewportHeight - edgePadding;
  const row = virtualRows.find((item) => item.index === index);

  if (!row) {
    return true;
  }

  return row.start < viewTop || row.end > viewBottom;
}
