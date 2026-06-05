import React from 'react';
import SettingsIcon from '@mui/icons-material/Settings';
import RssFeedIcon from '@mui/icons-material/RssFeed';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { TOOLTIPS } from '@/config/tooltips';
import { useFeedNavigation } from '@/contexts/FeedContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { Theme } from '@/services/settings';
import { SHORTCUT_LABELS, withShortcutHint } from '@/services/shortcuts/shortcutService';
import { ButtonStack, type ButtonConfig } from '@/components/common/ButtonStack';
import './BottomWidget.css';

const THEME_SEQUENCE: Theme[] = ['auto', 'light', 'dark'];

export const BottomWidget: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { openFeedEditView } = useFeedNavigation();
  const themeIconMap = {
    auto: BrightnessAutoIcon,
    light: LightModeIcon,
    dark: DarkModeIcon,
  } as const;

  const handleSettings = () => {
    if (window.electronAPI) {
      window.electronAPI.openSettings();
    }
  };

  const handleThemeCycle = () => {
    const currentStateIndex = Math.max(0, THEME_SEQUENCE.indexOf(theme));
    const nextTheme = THEME_SEQUENCE[(currentStateIndex + 1) % THEME_SEQUENCE.length] ?? 'auto';
    setTheme(nextTheme);
  };

  const getThemeTooltip = () => {
    if (theme === 'auto') return TOOLTIPS.sidebar.themeAuto;
    if (theme === 'light') return TOOLTIPS.sidebar.themeLight;
    return TOOLTIPS.sidebar.themeDark;
  };

  const ThemeIcon = themeIconMap[theme];
  const settingsTooltip = withShortcutHint(TOOLTIPS.sidebar.settings, SHORTCUT_LABELS.OPEN_SETTINGS);
  const editFeedsTooltip = withShortcutHint(TOOLTIPS.sidebar.editFeeds, SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW);
  const themeTooltip = getThemeTooltip();
  const actionButtons: ButtonConfig[] = [
    {
      id: 'theme-cycle',
      icon: ThemeIcon,
      label: themeTooltip,
      onClick: () => {
        handleThemeCycle();
      },
    },
    {
      id: 'edit-feeds',
      icon: RssFeedIcon,
      label: editFeedsTooltip,
      onClick: () => {
        openFeedEditView();
      },
    },
  ];

  return (
    <div className="bottom-widget has-no-drag">
      <ButtonStack
        buttons={actionButtons}
        direction="right"
        layoutMode="push"
        coverIcon={SettingsIcon}
        coverLabel={settingsTooltip}
        onCoverClick={handleSettings}
        className="bottom-widget-button-stack"
      />
    </div>
  );
};
