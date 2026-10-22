import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sidebar } from './Sidebar';
import { seedFeedHealth } from '@/services/feeds/feedHealthSync';
import { getThemeDebugFeeds } from '@/stories/themeDebugRuntime';

const meta = {
  title: 'Theme Debug/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    kiji: { variant: 'sidebar-default' },
  },
  render: () => (
    <div className="theme-debug-surface">
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
    </div>
  ),
};

export const Overflow: Story = {
  parameters: {
    kiji: { variant: 'sidebar-overflow' },
  },
  render: () => (
    <div className="theme-debug-surface" style={{ height: 'min(480px, 100%)' }}>
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
    </div>
  ),
};


/** One unstationed feed and one feed in “Technology” can’t update: quiet marker + station hint. */
export const FeedCannotUpdate: Story = {
  parameters: {
    kiji: { variant: 'sidebar-feed-health' },
  },
  render: () => {
    // The app seeds this from its first library read; the story seeds it from the fixtures.
    seedFeedHealth(getThemeDebugFeeds());
    return (
      <div className="theme-debug-surface">
        <div className="theme-debug-sidebar-frame">
          <Sidebar />
        </div>
      </div>
    );
  },
};
