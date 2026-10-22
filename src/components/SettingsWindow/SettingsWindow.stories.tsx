import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AppearanceGlyph, BookGlyph, EnvelopeGlyph, GearGlyph, KeyboardGlyph, SparklesGlyph } from './settingsIcons';
import { SettingsPane } from './settingsControls';
import { GeneralPane } from './panes/GeneralPane';
import type { SettingsWindowState } from './useSettingsWindowState';
import './SettingsWindow.css';

// The full window's state hook reads persisted settings; the story renders the same
// sidebar + pane markup around GeneralPane with fixed values. Native rows (background
// mode, badge, notifications) answer from `.storybook/mocks/tauri.ts`.
const NAV = [
  { id: 'general', label: 'General', icon: <GearGlyph /> },
  { id: 'appearance', label: 'Appearance', icon: <AppearanceGlyph /> },
  { id: 'reading', label: 'Reading', icon: <BookGlyph /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <KeyboardGlyph /> },
  { id: 'assistant', label: 'Assistant', icon: <SparklesGlyph /> },
  { id: 'contact', label: 'Contact', icon: <EnvelopeGlyph /> },
];

const GENERAL_STATE: SettingsWindowState['general'] = {
  backgroundUpdate: 'every-15m',
  contentParser: 'defuddle',
  articleRetention: 'never',
  savedArticlesSyncFolder: null,
  isPickingSavedArticlesSyncFolder: false,
  onBackgroundUpdateChange: fn(),
  onContentParserChange: fn(),
  onArticleRetentionChange: fn(),
  onSavedArticlesSyncToggle: fn(),
  onSavedArticlesSyncFolderPick: fn(),
};

const SettingsGeneralFrame = () => (
  <div style={{ width: 760, height: 760, margin: '20px auto' }}>
    <div className="settings-window">
      <div className="settings-window-content">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-top-chrome" aria-hidden="true" />
          <nav className="settings-nav" aria-label="Settings">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item${item.id === 'general' ? ' is-active' : ''}`}
                aria-current={item.id === 'general' ? 'page' : undefined}
              >
                <span className="settings-nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="settings-main">
          <SettingsPane title="General" subtitle="Updates, notifications and saved articles.">
            <GeneralPane state={GENERAL_STATE} />
          </SettingsPane>
        </main>
      </div>
    </div>
  </div>
);

const meta = {
  title: 'Theme Debug/Settings Window',
  component: SettingsGeneralFrame,
  parameters: {
    layout: 'fullscreen',
    // Like production: the Reader theme toolbar recolors the accent only.
    kiji: { readerThemeScope: 'accent' },
  },
} satisfies Meta<typeof SettingsGeneralFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

/** General pane with "Show unread count on app icon" and "Notify me about new articles". */
export const General: Story = {};
