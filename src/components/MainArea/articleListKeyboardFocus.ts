export function resolveArticleListFocusHash(
  keyboardFocusHash: string | null,
  activeArticleHash: string | null,
): string | null {
  return keyboardFocusHash ?? activeArticleHash;
}

export function resolveArticleListFocusIndex(
  articles: ReadonlyArray<{ hash: string }>,
  keyboardFocusHash: string | null,
  activeArticleHash: string | null,
): number {
  const focusHash = resolveArticleListFocusHash(keyboardFocusHash, activeArticleHash);
  if (!focusHash) {
    return -1;
  }
  return articles.findIndex((article) => article.hash === focusHash);
}
