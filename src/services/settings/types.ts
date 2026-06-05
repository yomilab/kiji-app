/**
 * User Settings Types
 *
 * Defines the structure for user settings including UI preferences
 */

import { FontStack } from './fontFamilies';
import type { BackgroundUpdateMode } from '../scheduler/types';
import { DEFAULT_SMART_VIEW_DEFINITIONS, type SmartViewId } from '@/constants';
import {
  type ContentParser,
  DEFAULT_CONTENT_PARSER,
} from '@/services/articles/extractors/types';

export type Theme = 'auto' | 'light' | 'dark';
export type LayoutType = '2-column' | '3-column';
export type { ContentParser } from '@/services/articles/extractors/types';
export { DEFAULT_CONTENT_PARSER, isContentParser } from '@/services/articles/extractors/types';

export interface WindowSize {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface FontFamilySettings {
  uiFont: string; // Font for sidebar, modals, and UI elements
  articleTitleFont: string; // Font for article-list titles and the article-view header title
  articleContentFont: string; // Font for article descriptions and all article body content
  articleNonAsciiFont: string; // Font for non-ASCII text in article list and article view
}

export interface ReadingLayoutSettings {
  enabled: boolean; // Whether custom reading layout overrides are active
  fontSize: number; // Article body font size in pixels
  fontWeight: number; // Article body font weight
  lineSpacing: number; // Unitless line-height multiplier
  characterSpacing: number; // Percentage of font size converted to em
  wordSpacing: number; // Percentage of font size converted to em
  maxWidth: number; // Maximum article-content width in pixels
  justifyText: boolean; // Whether article body text is justified
}

export interface SidebarLibrarySettings {
  title: string;
  visible: boolean;
}

export interface SmartViewSettings {
  id: SmartViewId;
  visible: boolean;
  sortOrder: number;
}

export interface UserSettings {
  theme: Theme;
  layout: LayoutType;
  sidebarWidth: number; // in pixels
  articleListWidth: number; // in pixels
  windowSize: WindowSize;
  fontFamilies: FontFamilySettings; // Font family configuration
  readingLayout: ReadingLayoutSettings; // Reading typography and content width configuration
  backgroundUpdate: BackgroundUpdateMode; // Background feed update mode
  contentParser: ContentParser; // Engine used to extract article content from a page URL
  savedArticlesSyncFolder: string | null; // Optional folder that mirrors saved articles as markdown files
  sidebarLibrary: SidebarLibrarySettings;
  smartViews: SmartViewSettings[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'auto',
  layout: '2-column',
  sidebarWidth: 300,
  articleListWidth: 350,
  windowSize: {
    width: 800,
    height: 600,
  },
  fontFamilies: {
    uiFont: FontStack.UI_DEFAULT,
    articleTitleFont: FontStack.ARTICLE_TITLE_DEFAULT,
    articleContentFont: FontStack.ARTICLE_CONTENT_DEFAULT,
    articleNonAsciiFont: FontStack.ARTICLE_NON_ASCII_DEFAULT,
  },
  readingLayout: {
    enabled: false,
    fontSize: 18,
    fontWeight: 500,
    lineSpacing: 1.8,
    characterSpacing: 0,
    wordSpacing: 0,
    maxWidth: 720,
    justifyText: false,
  },
  backgroundUpdate: 'every-15m',
  contentParser: DEFAULT_CONTENT_PARSER,
  savedArticlesSyncFolder: null,
  sidebarLibrary: {
    title: 'Library',
    visible: true,
  },
  smartViews: DEFAULT_SMART_VIEW_DEFINITIONS.map((view, index) => ({
    id: view.id,
    visible: true,
    sortOrder: index,
  })),
};
