import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import { isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import { logger } from '@/services/logger';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { AssistantSettings } from './AssistantSettings';
import {
  AppearanceGlyph,
  BookGlyph,
  EnvelopeGlyph,
  GearGlyph,
  KeyboardGlyph,
  SparklesGlyph,
} from './settingsIcons';
import { SettingsPane } from './settingsControls';
import { useSettingsWindowState } from './useSettingsWindowState';
import { GeneralPane } from './panes/GeneralPane';
import { AppearancePane } from './panes/AppearancePane';
import { ReadingPane } from './panes/ReadingPane';
import { ShortcutsPane } from './panes/ShortcutsPane';
import { ContactPane } from './panes/ContactPane';
import './SettingsWindow.css';

export type SettingsCategory = 'general' | 'appearance' | 'reading' | 'shortcuts' | 'assistant' | 'contact';

export const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategory;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}> = [
  { id: 'general', label: 'General', subtitle: 'Updates, notifications and saved articles.', icon: <GearGlyph /> },
  { id: 'appearance', label: 'Appearance', subtitle: 'Theme, interface font and app icon.', icon: <AppearanceGlyph /> },
  { id: 'reading', label: 'Reading', subtitle: 'Fonts and layout for articles.', icon: <BookGlyph /> },
  { id: 'shortcuts', label: 'Shortcuts', subtitle: 'Keyboard shortcuts for common actions.', icon: <KeyboardGlyph /> },
  { id: 'assistant', label: 'Assistant', subtitle: 'Connect AI apps to your library.', icon: <SparklesGlyph /> },
  { id: 'contact', label: 'Contact', subtitle: 'Get help or send feedback.', icon: <EnvelopeGlyph /> },
];

const handleWindowDragMouseDown = (event: React.MouseEvent<HTMLElement>) => {
  if (event.button !== 0) {
    return;
  }

  if (
    event.target instanceof Element
    && event.target.closest(
      'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]',
    ) !== null
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const currentWindow = getCurrentWindow();
  void (event.detail === 2 ? currentWindow.toggleMaximize() : currentWindow.startDragging());
};

export const SettingsWindow: React.FC = () => {
  useSystemAccentColor();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const state = useSettingsWindowState();

  useMountEffect(() => {
    logger.info('SettingsWindow', 'Settings window mounted');
  });

  // Handle window close on Esc key
  useEffect(() => {
    return keybindingService.register({
      type: 'keydown',
      priority: 20,
      handler: (e: KeyboardEvent) => {
        if (!isCloseOnEscapeShortcut(e)) {
          return;
        }

        void getCurrentWindow().close();
      },
    });
  }, []);

  const active = SETTINGS_CATEGORIES.find((category) => category.id === activeCategory) ?? SETTINGS_CATEGORIES[0];

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return <GeneralPane state={state.general} />;
      case 'appearance':
        return <AppearancePane state={state.appearance} />;
      case 'reading':
        return <ReadingPane state={state.reading} />;
      case 'shortcuts':
        return <ShortcutsPane />;
      case 'assistant':
        return <AssistantSettings />;
      case 'contact':
        return <ContactPane state={state.contact} />;
      default:
        return null;
    }
  };

  return (
    <div className="settings-window">
      <div className="settings-window-content">
        <aside className="settings-sidebar">
          <div
            className="settings-sidebar-top-chrome"
            onMouseDown={handleWindowDragMouseDown}
            aria-hidden="true"
          />
          <nav className="settings-nav" aria-label="Settings">
            {SETTINGS_CATEGORIES.map((category) => {
              const isActive = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`settings-nav-item${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  data-category={category.id}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <span className="settings-nav-icon" aria-hidden="true">
                    {category.icon}
                  </span>
                  <span className="settings-nav-label">{category.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="settings-main">
          <SettingsPane
            key={active.id}
            title={active.label}
            subtitle={active.subtitle}
            onHeaderMouseDown={handleWindowDragMouseDown}
          >
            {renderContent()}
          </SettingsPane>
        </main>
      </div>
    </div>
  );
};
