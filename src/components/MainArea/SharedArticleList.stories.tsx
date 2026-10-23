import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SharedArticleList } from './SharedArticleList';

const meta = {
  title: 'Theme Debug/Article List',
  component: SharedArticleList,
  args: {
    layout: '3-column',
    variant: 'common',
  },
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof SharedArticleList>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderList: Story['render'] = (args) => (
  <div className="theme-debug-surface">
    <div className="main-area theme-debug-list-frame">
      <SharedArticleList {...args} />
    </div>
  </div>
);

export const Populated: Story = {
  parameters: {
    kiji: { variant: 'article-list-populated' },
  },
  render: renderList,
};

export const CompactDensity: Story = {
  parameters: {
    kiji: { variant: 'article-list-populated', listDensity: 'compact' },
  },
  render: renderList,
};

export const LargeImagesDensity: Story = {
  parameters: {
    kiji: { variant: 'article-list-populated', listDensity: 'large-images' },
  },
  render: renderList,
};

export const LongContent: Story = {
  parameters: {
    kiji: { variant: 'article-list-long' },
  },
  render: renderList,
};

export const Loading: Story = {
  parameters: {
    kiji: { variant: 'article-list-loading' },
  },
  render: renderList,
};

/** Opens list search with ⌘F and types `query`, as a user would. */
function TypeSearchQuery({ query }: { query: string }) {
  useEffect(() => {
    const open = window.setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true }));
    }, 50);
    const type = window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.article-list-search-input');
      if (!input) return;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 300);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(type);
    };
  }, [query]);
  return null;
}

/** Rows that matched only in the article text show an excerpt around the match. */
export const SearchSnippets: Story = {
  parameters: {
    kiji: { variant: 'article-list-search-snippets' },
  },
  render: (args) => (
    <div className="theme-debug-surface">
      <div className="main-area theme-debug-list-frame">
        <SharedArticleList {...args} />
        <TypeSearchQuery query="reading" />
      </div>
    </div>
  ),
};
