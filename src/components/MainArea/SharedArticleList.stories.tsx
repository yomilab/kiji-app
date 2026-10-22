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

