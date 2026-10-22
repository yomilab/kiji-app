import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  FeedsGlyph,
  ImportExportGlyph,
  SidebarItemsGlyph,
  StationsGlyph,
} from '@/components/SettingsWindow/settingsIcons';
import type { MuteRule } from '@/types/muteRules';
import { FiltersGlyph, FiltersPane, type MuteRulesService } from './FiltersPane';
import '@/components/SettingsWindow/SettingsWindow.css';
import './ManageFeedsWindow.css';

/*
 * The Filters tab inside the Manage Feeds window chrome. The chrome is drawn here with the
 * window's own classes (the full window needs the native library and window bridge).
 */

const RULES: MuteRule[] = [
  { id: 'r1', text: 'giveaway', matchDescription: false, scope: { kind: 'all' }, action: 'mark-read' },
  { id: 'r2', text: 'Sponsored', matchDescription: true, scope: { kind: 'all' }, action: 'mark-read' },
  { id: 'r3', text: 'transfer rumours', matchDescription: false, scope: { kind: 'station', name: 'Sports' }, action: 'mark-read' },
  { id: 'r4', text: '比特币', matchDescription: false, scope: { kind: 'feed', id: 'feed-markets' }, action: 'mark-read' },
];

const FEEDS = [
  { id: 'feed-markets', title: 'Markets Daily' },
  { id: 'feed-verge', title: 'The Verge' },
];
const STATIONS = [{ name: 'News' }, { name: 'Sports' }];

const TABS = [
  { id: 'feeds', label: 'Feeds', icon: <FeedsGlyph /> },
  { id: 'stations', label: 'Stations', icon: <StationsGlyph /> },
  { id: 'library', label: 'Library', icon: <SidebarItemsGlyph /> },
  { id: 'filters', label: 'Filters', icon: <FiltersGlyph /> },
  { id: 'import-export', label: 'Import & Export', icon: <ImportExportGlyph /> },
];

/** In-memory rules so the tab renders without the native side. */
const createStoryService = (initial: MuteRule[]): MuteRulesService => {
  let rules = initial;
  return {
    get: async () => rules,
    set: async (next) => {
      rules = next;
      return next;
    },
    preview: async (rule) => ({ matched: rule.text.length % 7, scanned: 500 }),
    applyToExisting: async () => ({ markedCount: 6, feeds: [] }),
  };
};

const FiltersWindow = ({ rules }: { rules: MuteRule[] }) => (
  <div style={{ width: 780, height: 560, overflow: 'hidden', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.25)', display: 'flex' }}>
    <div className="settings-window manage-feeds-window">
      <header className="mf-titlebar">
        <div className="mf-window-title" aria-hidden="true">Filters</div>
        <div className="mf-toolbar-tabs" role="tablist" aria-label="Manage feeds">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === 'filters'}
              className={`mf-toolbar-tab${tab.id === 'filters' ? ' is-active' : ''}`}
              data-tab={tab.id}
            >
              <span className="mf-toolbar-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="mf-toolbar-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </header>
      <main className="mf-main" role="tabpanel">
        <div className="mf-pane">
          <div className="mf-pane-header">
            <p className="mf-pane-summary">Mute words</p>
          </div>
          <FiltersPane feeds={FEEDS} stations={STATIONS} service={createStoryService(rules)} />
        </div>
      </main>
    </div>
  </div>
);

const meta = {
  title: 'Theme Debug/Manage Feeds Filters',
  component: FiltersWindow,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FiltersWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRules: Story = { args: { rules: RULES } };

export const Empty: Story = { args: { rules: [] } };
