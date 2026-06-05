import React from 'react';
import { ArticleView } from '@/components/MainArea/ArticleView';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import type { Article } from '@/types/article';

interface ArticleWindowProps {
  article: Article;
}

/**
 * ArticleWindow - Wrapper component for displaying articles in standalone windows
 *
 * This component simply wraps ArticleView with standalone mode enabled,
 * reusing all the same functionality and styling.
 */
export const ArticleWindow: React.FC<ArticleWindowProps> = ({ article }) => {
  // Initialize system accent color - sets CSS variable
  useSystemAccentColor();

  return <ArticleView article={article} standalone={true} />;
};
