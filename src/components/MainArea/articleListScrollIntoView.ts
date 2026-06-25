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
