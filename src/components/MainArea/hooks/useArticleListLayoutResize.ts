import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { settingsManager } from '@/services/settings';
import { LayoutType } from '@/services/settings/types';

const MIN_ARTICLE_LIST_WIDTH = 250;
const MAX_ARTICLE_LIST_WIDTH = 600;

interface UseArticleListLayoutResizeOptions {
  articleListRef: RefObject<HTMLDivElement>;
  layout: LayoutType;
}

export const useArticleListLayoutResize = ({
  articleListRef,
  layout,
}: UseArticleListLayoutResizeOptions) => {
  const [articleListWidth, setArticleListWidth] = useState(350);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const width = await settingsManager.getArticleListWidth();
        setArticleListWidth(width);
      } catch (error) {
        console.error('Error loading article list width from settings:', error);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    if (!isDragging || layout === '2-column') return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!articleListRef.current) return;

      const articleListRect = articleListRef.current.getBoundingClientRect();
      const newWidth = event.clientX - articleListRect.left;
      const constrainedWidth = Math.max(MIN_ARTICLE_LIST_WIDTH, Math.min(MAX_ARTICLE_LIST_WIDTH, newWidth));
      setArticleListWidth(constrainedWidth);
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      try {
        await settingsManager.setArticleListWidth(articleListWidth);
      } catch (error) {
        console.error('Error saving article list width to settings:', error);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, layout, articleListWidth, articleListRef]);

  const handleBorderMouseDown = () => {
    if (layout === '3-column') {
      setIsDragging(true);
    }
  };

  const widthStyle: CSSProperties | undefined = layout === '3-column' ? { width: `${articleListWidth}px` } : undefined;
  const showResizeHandle = layout === '3-column';

  return {
    isDragging,
    widthStyle,
    showResizeHandle,
    handleBorderMouseDown,
  };
};
