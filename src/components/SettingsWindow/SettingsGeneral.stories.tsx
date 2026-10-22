import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SettingsPane } from './settingsControls';
import {
  AppearanceGlyph,
  BookGlyph,
  EnvelopeGlyph,
  GearGlyph,
  KeyboardGlyph,
  SparklesGlyph,
} from './settingsIcons';
import { GeneralPane } from './panes/GeneralPane';
import type { SettingsWindowState } from './useSettingsWindowState';
import './SettingsWindow.css';

// SettingsWindow.tsx pulls the live settings hook (not mockable here), so the
// story mirrors its frame and feeds GeneralPane a fixture state.
const NAV = [
  { id: 'general', label: 'General', icon: <GearGlyph /> },
  { id: 'appearance', label: 'Appearance', icon: <AppearanceGlyph /> },
  { id: 'reading', label: 'Reading', icon: <BookGlyph /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <KeyboardGlyph /> },
  { id: 'assistant', label: 'Assistant', icon: <SparklesGlyph /> },
  { id: 'contact', label: 'Contact', icon: <EnvelopeGlyph /> },
];

const GeneralSettingsFrame = (state: SettingsWindowState['general']) => (
  // Same default size as the `settings` window in tauri.conf.json (700×660).
  <div style={{ width: 700, height: 660, overflow: 'hidden', position: 'relative' }}>
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
          <SettingsPane title="General" subtitle="Updates and saved articles.">
            <GeneralPane state={state} />
          </SettingsPane>
        </main>
      </div>
    </div>
  </div>
);

const meta = {
  title: 'Theme Debug/Settings General',
  component: GeneralSettingsFrame,
  parameters: { layout: 'centered' },
  args: {
    backgroundUpdate: 'every-15m',
    contentParser: 'defuddle',
    articleRetention: '3m',
    savedArticlesSyncFolder: null,
    isPickingSavedArticlesSyncFolder: false,
    onBackgroundUpdateChange: fn(),
    onContentParserChange: fn(),
    onArticleRetentionChange: fn(),
    onSavedArticlesSyncToggle: fn(),
    onSavedArticlesSyncFolderPick: fn(),
  },
} satisfies Meta<typeof GeneralSettingsFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Remove old read articles" row in the Storage group. */
export const RemoveOldReadArticles: Story = {};
