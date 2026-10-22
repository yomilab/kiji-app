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

/** Opens the list header's Mark as Read menu once mounted (screenshot state). */
function OpenMarkReadMenu() {
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = document.querySelector<HTMLButtonElement>('[data-widget="mark-read"]');
      if (button && button.getAttribute('aria-expanded') !== 'true') button.click();
      if (button || attempts > 50) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

export const MarkReadMenu: Story = {
  parameters: {
    kiji: { variant: 'article-list-populated' },
  },
  render: (args, context) => (
    <>
      {renderList(args, context)}
      <OpenMarkReadMenu />
    </>
  ),
};
