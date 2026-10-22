import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  THEME_DEBUG_ARTICLES,
  THEME_DEBUG_IMAGE_ARTICLE,
  THEME_DEBUG_LONG_ARTICLE,
} from '@/stories/themeDebugFixtures';
import type { CSSProperties } from 'react';
import { ArticleView } from './ArticleView';
import { ReaderTextSizeIndicator } from './ReaderTextSizeControl';

const meta = {
  title: 'Theme Debug/Article View',
  component: ArticleView,
  args: {
    article: THEME_DEBUG_ARTICLES[0],
    standalone: true,
    deckOpen: false,
  },
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof ArticleView>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderStandalone: Story['render'] = (args) => (
  <div className="theme-debug-article-frame">
    <ArticleView key={args.article?.hash} {...args} />
  </div>
);

export const Standalone: Story = {
  parameters: {
    kiji: { variant: 'article-view-standalone' },
  },
  render: renderStandalone,
};

export const LongArticle: Story = {
  args: {
    article: THEME_DEBUG_LONG_ARTICLE,
  },
  parameters: {
    kiji: { variant: 'article-view-long' },
  },
  render: renderStandalone,
};

/** ⌘+ four times from the default size: 140% (25px) with the size indicator still showing. */
export const TextSize140: Story = {
  args: {
    article: THEME_DEBUG_LONG_ARTICLE,
  },
  parameters: {
    kiji: { variant: 'article-view-text-size-140' },
  },
  render: (args) => (
    <div
      className="theme-debug-article-frame"
      style={{ '--article-content-font-size': '25px' } as CSSProperties}
    >
      <ArticleView key={args.article?.hash} {...args} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none' }}>
        <ReaderTextSizeIndicator percent={140} visible />
      </div>
    </div>
  ),
};

export const StandaloneImages: Story = {
  args: {
    article: THEME_DEBUG_IMAGE_ARTICLE,
  },
  parameters: {
    kiji: { variant: 'article-view-images' },
  },
  render: renderStandalone,
};

export const EmbeddedOpen: Story = {
  args: {
    article: undefined,
    standalone: false,
    deckOpen: true,
  },
  parameters: {
    kiji: { variant: 'article-view-embedded' },
  },
  render: (args) => (
    <div className="theme-debug-article-frame">
      <div className="app-container article-view-active">
        <div className="app-deck-root">
          <div className="app-layer app-layer-article">
            <ArticleView key="embedded-theme-debug" {...args} />
          </div>
        </div>
      </div>
    </div>
  ),
};

