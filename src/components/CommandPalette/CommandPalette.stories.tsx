import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { SharedArticleList } from '@/components/MainArea/SharedArticleList';
import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';
import { SHORTCUT_LABELS } from '@/services/shortcuts/shortcutService';
import { THEME_DEBUG_FEEDS, THEME_DEBUG_TAGS } from '@/stories/themeDebugFixtures';
import { CommandPalette } from './CommandPalette';
import { buildCommandPaletteEntries } from './commandPaletteModel';

const noop = (): void => {};

const entries = buildCommandPaletteEntries(
  {
    feeds: THEME_DEBUG_FEEDS,
    stations: THEME_DEBUG_TAGS,
    smartViews: DEFAULT_SMART_VIEW_DEFINITIONS.map((view) => ({ id: view.id, visible: true })),
  },
  [
    { id: 'refresh', title: 'Refresh', shortcut: SHORTCUT_LABELS.REFRESH_FEED },
    { id: 'add-feed', title: 'Add Feed', shortcut: SHORTCUT_LABELS.ADD_FEED },
    { id: 'manage-feeds', title: 'Manage Feeds', shortcut: SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW },
    { id: 'settings', title: 'Settings', shortcut: SHORTCUT_LABELS.OPEN_SETTINGS },
    { id: 'theme-dark', title: 'Theme: Dark' },
  ],
);

const meta = {
  title: 'Theme Debug/Command Palette',
  component: CommandPalette,
  args: {
    entries,
    recentKeys: ['feed:feed-type'],
    onPick: noop,
    onClose: noop,
    initialQuery: 're',
  },
  parameters: {
    layout: 'fullscreen',
    kiji: { variant: 'article-list-populated' },
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Palette open over the main window (sidebar + article list), with a query typed. */
export const OverMainWindow: Story = {
  render: (args) => (
    <div className="theme-debug-surface" style={{ display: 'flex' }}>
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
      <div className="main-area theme-debug-list-frame" style={{ flex: 1, width: 'auto' }}>
        <SharedArticleList layout="3-column" variant="common" />
      </div>
      <CommandPalette {...args} />
    </div>
  ),
};

export const NoMatches: Story = {
  args: { initialQuery: 'zzzz' },
  render: OverMainWindow.render,
};
