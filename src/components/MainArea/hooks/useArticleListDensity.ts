import { useEffect, useState } from 'react';
import { settingsManager } from '@/services/settings';
import {
  DEFAULT_ARTICLE_LIST_DENSITY,
  normalizeArticleListDensity,
  type ArticleListDensity,
} from '@/lib/articleListDensity';

/**
 * Article list density from renderer settings. Reloads on the cross-window
 * settings-changed event so a change in Settings applies live in the main window.
 */
export function useArticleListDensity(): ArticleListDensity {
  const [density, setDensity] = useState<ArticleListDensity>(() => {
    try {
      return normalizeArticleListDensity(settingsManager.getArticleListDensityNow());
    } catch {
      return DEFAULT_ARTICLE_LIST_DENSITY;
    }
  });

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const settings = await settingsManager.getSettings();
        if (!disposed) {
          setDensity(normalizeArticleListDensity(settings.articleListDensity));
        }
      } catch (error) {
        console.error('[ArticleList] Failed to load list density:', error);
      }
    };

    void load();
    const removeListener = window.kijiAPI?.onSettingsChanged?.(() => {
      void load();
    });

    return () => {
      disposed = true;
      if (typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, []);

  return density;
}
