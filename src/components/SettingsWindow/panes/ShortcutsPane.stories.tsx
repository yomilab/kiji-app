import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsPane } from '../settingsControls';
import { ShortcutsPane } from './ShortcutsPane';
import '../SettingsWindow.css';

const meta = {
  title: 'Theme Debug/Settings Shortcuts',
  component: ShortcutsPane,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof ShortcutsPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Shortcuts pane as the Settings window shows it (content column only). */
export const Default: Story = {
  render: () => (
    <div className="settings-window" style={{ height: '100vh' }}>
      <div className="settings-window-content">
        <main className="settings-main">
          <SettingsPane title="Shortcuts">
            <ShortcutsPane />
          </SettingsPane>
        </main>
      </div>
    </div>
  ),
};
