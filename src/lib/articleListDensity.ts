/**
 * Article list row density (renderer preference).
 *
 * Lives outside `@/services/settings` so list components can import it at
 * runtime without pulling the settings service (Storybook aliases that path).
 */
export type ArticleListDensity = 'compact' | 'comfortable' | 'large-images';

export const DEFAULT_ARTICLE_LIST_DENSITY: ArticleListDensity = 'comfortable';

export const ARTICLE_LIST_DENSITY_OPTIONS: ReadonlyArray<{ value: ArticleListDensity; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'large-images', label: 'Large Images' },
];

export const normalizeArticleListDensity = (value: unknown): ArticleListDensity => (
  value === 'compact' || value === 'comfortable' || value === 'large-images'
    ? value
    : DEFAULT_ARTICLE_LIST_DENSITY
);

/** First-pass row height per density, before the row is measured. */
export const ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT: Record<ArticleListDensity, number> = {
  compact: 34,
  comfortable: 112,
  'large-images': 260,
};
