export type ArticleListTotalState = {
  loadedCount: number;
  totalCount: number;
  totalKnown: boolean;
  pageWasFull: boolean;
};

export const articleListHasMore = ({
  loadedCount,
  totalCount,
  totalKnown,
  pageWasFull,
}: ArticleListTotalState): boolean => {
  if (!totalKnown) {
    return pageWasFull;
  }
  return loadedCount < totalCount;
};

export const resolveDeferredPageTotal = (
  storedLength: number,
  queryLimit: number,
): { total: number; totalKnown: boolean; pageWasFull: boolean } => {
  if (storedLength < queryLimit) {
    return {
      total: storedLength,
      totalKnown: true,
      pageWasFull: false,
    };
  }

  return {
    total: storedLength,
    totalKnown: false,
    pageWasFull: true,
  };
};
