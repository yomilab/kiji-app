import React, { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { subscribeToWindowFocus } from '@/services/tauri/tauriEventSubscription';
import { settingsManager, DEFAULT_SETTINGS } from '@/services/settings';
import type { ContentParser } from '@/services/settings';
import type { BackgroundUpdateMode } from '@/services/scheduler/types';
import { CJK_FONT_OPTIONS, COMMON_FONT_OPTIONS } from '@/services/settings/fontFamilies';
import { useTheme } from '@/contexts/ThemeContext';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import { SHORTCUT_LABELS, isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import { logger } from '@/services/logger';
import { APP_NAME, CONTACT_EMAIL_ADDRESS } from '@/config/appIdentity';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import ContactMailOutlinedIcon from '@mui/icons-material/ContactMailOutlined';
import FormatLineSpacingIcon from '@mui/icons-material/FormatLineSpacing';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import SpaceBarIcon from '@mui/icons-material/SpaceBar';
import CropLandscapeOutlinedIcon from '@mui/icons-material/CropLandscapeOutlined';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import FormatAlignJustifyIcon from '@mui/icons-material/FormatAlignJustify';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FileOpenOutlinedIcon from '@mui/icons-material/FileOpenOutlined';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import { StatefulButtonGroup, type ButtonState } from '@/components/common/StatefulButtonGroup';
import defaultAppIconPreview from '@/assets/images/kiji-logo.png';
import defaultDarkAppIconPreview from '@/assets/images/kiji-logo-dark.png';
import sunsetAppIconPreview from '@/assets/images/kiji-logo-sunset.png';
import sunsetDarkAppIconPreview from '@/assets/images/kiji-logo-sunset-dark.png';
import cosmosAppIconPreview from '@/assets/images/kiji-logo-cosmos.png';
import cosmosDarkAppIconPreview from '@/assets/images/kiji-logo-cosmos-dark.png';
import particleAppIconPreview from '@/assets/images/kiji-logo-particle.png';
import particleDarkAppIconPreview from '@/assets/images/kiji-logo-particle-dark.png';
import './SettingsWindow.css';

type ConfigCategory = 'general' | 'appearance' | 'reading' | 'shortcuts' | 'contact';

interface ShortcutConfig {
  id: string;
  label: string;
  current: string;
  default: string;
}

interface ShortcutGroup {
  id: string;
  title: string;
  items: ShortcutConfig[];
}

interface ReadingSliderConfig {
  key: 'fontSize' | 'fontWeight' | 'lineSpacing' | 'characterSpacing' | 'wordSpacing' | 'maxWidth';
  label: string;
  min: number;
  max: number;
  step: number;
  icon: React.ReactNode;
  formatValue: (value: number) => string;
  toSliderValue?: (value: number) => number;
  fromSliderValue?: (value: number) => number;
}

interface SystemAppIconState {
  iconPath: string | null;
  previewDataUrl: string | null;
  hasCustomIcon: boolean;
  iconVariant: SystemAppIconVariant;
}

type SystemAppIconVariant =
  | 'light'
  | 'dark'
  | 'sunset'
  | 'sunset-dark'
  | 'cosmos'
  | 'cosmos-dark'
  | 'particle'
  | 'particle-dark';
const DEFAULT_SYSTEM_APP_ICON_VARIANT: SystemAppIconVariant = 'cosmos';

const APP_ICON_VARIANT_OPTIONS: ReadonlyArray<{
  value: SystemAppIconVariant;
  label: string;
  source: string;
}> = [
  { value: 'light', label: 'Light', source: defaultAppIconPreview },
  { value: 'dark', label: 'Dark', source: defaultDarkAppIconPreview },
  { value: 'sunset', label: 'Sunset', source: sunsetAppIconPreview },
  { value: 'sunset-dark', label: 'Sunset Dark', source: sunsetDarkAppIconPreview },
  { value: 'cosmos', label: 'Cosmos', source: cosmosAppIconPreview },
  { value: 'cosmos-dark', label: 'Cosmos Dark', source: cosmosDarkAppIconPreview },
  { value: 'particle', label: 'Particle', source: particleAppIconPreview },
  { value: 'particle-dark', label: 'Particle Dark', source: particleDarkAppIconPreview },
];

const getDefaultAppIconPreview = (variant: SystemAppIconVariant): string => (
  APP_ICON_VARIANT_OPTIONS.find((option) => option.value === variant)?.source
    ?? defaultAppIconPreview
);

const createSteppedSliderTransform = (
  defaultValue: number,
  stepSize: number,
  precision = 0
): Required<Pick<ReadingSliderConfig, 'toSliderValue' | 'fromSliderValue'>> => ({
  // Keep persisted values and slider offsets in the same discrete step space so remounts
  // always restore the thumb to the exact position the user chose.
  toSliderValue: (value) => Math.round((value - defaultValue) / stepSize),
  fromSliderValue: (value) => Number((defaultValue + (value * stepSize)).toFixed(precision)),
});

export const SettingsWindow: React.FC = () => {
  useSystemAccentColor();
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('general');
  const [backgroundUpdate, setBackgroundUpdate] = useState<BackgroundUpdateMode>(
    DEFAULT_SETTINGS.backgroundUpdate,
  );
  const [contentParser, setContentParser] = useState<ContentParser>(DEFAULT_SETTINGS.contentParser);
  const [savedArticlesSyncFolder, setSavedArticlesSyncFolder] = useState<string | null>(null);
  const isSavedArticlesSyncEnabled = savedArticlesSyncFolder !== null;
  const { fontFamilies, updateFontFamilies, readingLayout, updateReadingLayout } = useTheme();
  const [localFonts, setLocalFonts] = useState({
    uiFont: fontFamilies.uiFont,
    articleTitleFont: fontFamilies.articleTitleFont,
    articleContentFont: fontFamilies.articleContentFont,
    articleNonAsciiFont: fontFamilies.articleNonAsciiFont,
  });
  const [localReadingLayout, setLocalReadingLayout] = useState(readingLayout);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [isPickingSavedArticlesSyncFolder, setIsPickingSavedArticlesSyncFolder] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [isOpeningContactEmail, setIsOpeningContactEmail] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [systemAppIcon, setSystemAppIcon] = useState<SystemAppIconState>({
    iconPath: null,
    previewDataUrl: null,
    hasCustomIcon: false,
    iconVariant: DEFAULT_SYSTEM_APP_ICON_VARIANT,
  });
  const [appIconStatus, setAppIconStatus] = useState<string | null>(null);
  const [isPickingSystemAppIcon, setIsPickingSystemAppIcon] = useState(false);
  const [isResettingSystemAppIcon, setIsResettingSystemAppIcon] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);

  console.log('SettingsWindow component rendering, activeCategory:', activeCategory);
  useMountEffect(() => {
    logger.info('SettingsWindow', 'Settings window mounted');
  });

  // Load persisted settings on mount and whenever the settings window is shown again.
  useEffect(() => {
    let disposed = false;

    const loadSettings = async () => {
      try {
        const settings = await settingsManager.getSettings();
        if (disposed) {
          return;
        }

        setBackgroundUpdate(settings.backgroundUpdate ?? DEFAULT_SETTINGS.backgroundUpdate);
        setContentParser(settings.contentParser ?? DEFAULT_SETTINGS.contentParser);
        setSavedArticlesSyncFolder(settings.savedArticlesSyncFolder ?? null);

        if (window.kijiAPI?.getSystemAppIconState) {
          setSystemAppIcon(await window.kijiAPI.getSystemAppIconState());
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };

    void loadSettings();

    const reloadFromPersistedSettings = () => {
      void loadSettings();
    };

    const removeSettingsChangedListener = window.kijiAPI?.onSettingsChanged?.(reloadFromPersistedSettings);
    const removeFocusListener = subscribeToWindowFocus(() => {
      void loadSettings();
    });

    return () => {
      disposed = true;
      if (typeof removeSettingsChangedListener === 'function') {
        removeSettingsChangedListener();
      }
      removeFocusListener();
    };
  }, []);

  // Sync local fonts with context when fontFamilies change
  useEffect(() => {
    setLocalFonts({
      uiFont: fontFamilies.uiFont,
      articleTitleFont: fontFamilies.articleTitleFont,
      articleContentFont: fontFamilies.articleContentFont,
      articleNonAsciiFont: fontFamilies.articleNonAsciiFont,
    });
  }, [fontFamilies]);

  // Mirror live reading-layout updates from the shared appearance context.
  useEffect(() => {
    setLocalReadingLayout(readingLayout);
  }, [readingLayout]);

  const shortcutConfigs: ShortcutConfig[] = [
    {
      id: 'add-feed',
      label: 'Add New Feed',
      current: SHORTCUT_LABELS.ADD_FEED,
      default: SHORTCUT_LABELS.ADD_FEED,
    },
    {
      id: 'toggle-feed-view-mode',
      label: 'Toggle Feed View Mode',
      current: SHORTCUT_LABELS.TOGGLE_READER_MODE,
      default: SHORTCUT_LABELS.TOGGLE_READER_MODE,
    },
    {
      id: 'search',
      label: 'Search Articles',
      current: SHORTCUT_LABELS.SEARCH_ARTICLES,
      default: SHORTCUT_LABELS.SEARCH_ARTICLES,
    },
    {
      id: 'feed-edit-view',
      label: 'Open Feed Edit View',
      current: SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW,
      default: SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW,
    },
    {
      id: 'settings',
      label: 'Open Settings',
      current: SHORTCUT_LABELS.OPEN_SETTINGS,
      default: SHORTCUT_LABELS.OPEN_SETTINGS,
    },
    {
      id: 'close-article',
      label: 'Close Article View',
      current: SHORTCUT_LABELS.CLOSE_ARTICLE_VIEW,
      default: SHORTCUT_LABELS.CLOSE_ARTICLE_VIEW,
    },
    {
      id: 'save-article',
      label: 'Save/Unsave Article',
      current: SHORTCUT_LABELS.SAVE_ARTICLE,
      default: SHORTCUT_LABELS.SAVE_ARTICLE,
    },
    {
      id: 'copy-article-url',
      label: 'Copy Article URL',
      current: SHORTCUT_LABELS.COPY_ARTICLE_URL,
      default: SHORTCUT_LABELS.COPY_ARTICLE_URL,
    },
    {
      id: 'vim-scroll-top',
      label: 'Scroll to Top',
      current: SHORTCUT_LABELS.VIM_SCROLL_TOP,
      default: SHORTCUT_LABELS.VIM_SCROLL_TOP,
    },
    {
      id: 'vim-scroll-bottom',
      label: 'Scroll to Bottom',
      current: SHORTCUT_LABELS.VIM_SCROLL_BOTTOM,
      default: SHORTCUT_LABELS.VIM_SCROLL_BOTTOM,
    },
    {
      id: 'vim-scroll-half',
      label: 'Scroll Half Page',
      current: `${SHORTCUT_LABELS.VIM_SCROLL_HALF_DOWN} / ${SHORTCUT_LABELS.VIM_SCROLL_HALF_UP}`,
      default: `${SHORTCUT_LABELS.VIM_SCROLL_HALF_DOWN} / ${SHORTCUT_LABELS.VIM_SCROLL_HALF_UP}`,
    },
    {
      id: 'reset-settings',
      label: 'Reset All Settings',
      current: SHORTCUT_LABELS.RESET_SETTINGS,
      default: SHORTCUT_LABELS.RESET_SETTINGS,
    },
  ];

  const shortcutGroups: ShortcutGroup[] = [
    {
      id: 'feeds',
      title: 'Feeds',
      items: shortcutConfigs.filter((shortcut) => [
        'add-feed',
        'search',
        'feed-edit-view',
      ].includes(shortcut.id)),
    },
    {
      id: 'article',
      title: 'Article',
      items: shortcutConfigs.filter((shortcut) => [
        'close-article',
        'save-article',
        'toggle-feed-view-mode',
        'copy-article-url',
        'vim-scroll-top',
        'vim-scroll-bottom',
        'vim-scroll-half',
      ].includes(shortcut.id)),
    },
    {
      id: 'settings',
      title: 'Settings',
      items: shortcutConfigs.filter((shortcut) => [
        'settings',
        'reset-settings',
      ].includes(shortcut.id)),
    },
  ];

  const justifyButtonStates: ButtonState[] = [
    {
      key: 'left',
      icon: <FormatAlignLeftIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: 'Left-align article body text',
      title: 'Use left-aligned article body text',
    },
    {
      key: 'justify',
      icon: <FormatAlignJustifyIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />,
      ariaLabel: 'Justify article body text',
      title: 'Justify article body text',
    },
  ];

  const fontSizeSliderTransform = createSteppedSliderTransform(
    DEFAULT_SETTINGS.readingLayout.fontSize,
    1
  );
  const lineSpacingSliderTransform = createSteppedSliderTransform(
    DEFAULT_SETTINGS.readingLayout.lineSpacing,
    0.05,
    2
  );
  const fontWeightSliderTransform = createSteppedSliderTransform(
    DEFAULT_SETTINGS.readingLayout.fontWeight,
    50
  );
  const maxWidthSliderTransform = createSteppedSliderTransform(
    DEFAULT_SETTINGS.readingLayout.maxWidth,
    10
  );

  const readingSliderConfigs: ReadingSliderConfig[] = [
    {
      key: 'fontSize',
      label: 'Font Size',
      min: -3,
      max: 7,
      step: 1,
      icon: <FormatSizeIcon fontSize="inherit" />,
      formatValue: (value) => (
        value === DEFAULT_SETTINGS.readingLayout.fontSize
          ? `Default (${Math.round(value)}px)`
          : `${Math.round(value)}px`
      ),
      ...fontSizeSliderTransform,
    },
    {
      key: 'fontWeight',
      label: 'Font Weight',
      min: -1,
      max: 5,
      step: 1,
      icon: <FormatBoldIcon fontSize="inherit" />,
      formatValue: (value) => (
        value === DEFAULT_SETTINGS.readingLayout.fontWeight
          ? `Default (${Math.round(value)})`
          : `${Math.round(value)}`
      ),
      ...fontWeightSliderTransform,
    },
    {
      key: 'lineSpacing',
      label: 'Line Spacing',
      min: -9,
      max: 11,
      step: 1,
      icon: <FormatLineSpacingIcon fontSize="inherit" />,
      formatValue: (value) => {
        const delta = Math.round((value - DEFAULT_SETTINGS.readingLayout.lineSpacing) / 0.05);
        return delta === 0 ? 'Default' : `${delta > 0 ? '+' : ''}${delta}`;
      },
      ...lineSpacingSliderTransform,
    },
    {
      key: 'characterSpacing',
      label: 'Character Spacing',
      min: 0,
      max: 10,
      step: 1,
      icon: <TextFieldsIcon fontSize="inherit" />,
      formatValue: (value) => {
        const delta = Math.round((value - DEFAULT_SETTINGS.readingLayout.characterSpacing) / 1);
        return delta === 0 ? 'Default' : `${delta > 0 ? '+' : ''}${delta}`;
      },
    },
    {
      key: 'wordSpacing',
      label: 'Word Spacing',
      min: 0,
      max: 20,
      step: 1,
      icon: <SpaceBarIcon fontSize="inherit" />,
      formatValue: (value) => {
        const delta = Math.round((value - DEFAULT_SETTINGS.readingLayout.wordSpacing) / 1);
        return delta === 0 ? 'Default' : `${delta > 0 ? '+' : ''}${delta}`;
      },
    },
    {
      key: 'maxWidth',
      label: 'Max Width',
      min: -16,
      max: 24,
      step: 1,
      icon: <CropLandscapeOutlinedIcon fontSize="inherit" />,
      formatValue: (value) => {
        const delta = Math.round((value - DEFAULT_SETTINGS.readingLayout.maxWidth) / 10);
        return delta === 0 ? 'Default' : `${delta > 0 ? '+' : ''}${delta}`;
      },
      ...maxWidthSliderTransform,
    },
  ];

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

  const notifySettingsChanged = () => {
    if (!window.kijiAPI?.notifySettingsChanged) {
      return;
    }

    // Keep the settings UI responsive by letting the broadcast and any
    // follow-up sync scheduling happen outside the current interaction turn.
    window.setTimeout(() => {
      void window.kijiAPI.notifySettingsChanged().catch((error) => {
        console.error('Error notifying settings change:', error);
      });
    }, 0);
  };

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

  const handleBackgroundUpdateChange = async (mode: BackgroundUpdateMode) => {
    try {
      await settingsManager.setBackgroundUpdate(mode);
      setBackgroundUpdate(mode);

      // Notify main window to reconfigure scheduler
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving background update mode:', error);
    }
  };

  const handleContentParserChange = async (parser: ContentParser) => {
    try {
      await settingsManager.setContentParser(parser);
      setContentParser(parser);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving content parser:', error);
    }
  };

  const handleFontChange = async (
    fontType: 'uiFont' | 'articleTitleFont' | 'articleContentFont' | 'articleNonAsciiFont',
    value: string
  ) => {
    try {
      // Update local state immediately for responsive UI
      setLocalFonts(prev => ({ ...prev, [fontType]: value }));

      // Save to settings
      await updateFontFamilies({ [fontType]: value });

      // Notify other windows about settings change
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving font family:', error);
      // Revert on error
      setLocalFonts({
        uiFont: fontFamilies.uiFont,
        articleTitleFont: fontFamilies.articleTitleFont,
        articleContentFont: fontFamilies.articleContentFont,
        articleNonAsciiFont: fontFamilies.articleNonAsciiFont,
      });
    }
  };

  const handleReadingLayoutUpdate = async (
    patch: Partial<typeof localReadingLayout>
  ) => {
    const nextReadingLayout = {
      ...localReadingLayout,
      ...patch,
    };

    try {
      // Keep the controls responsive while persisting through the shared context.
      setLocalReadingLayout(nextReadingLayout);
      await updateReadingLayout(patch);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving reading layout settings:', error);
      setLocalReadingLayout(readingLayout);
    }
  };

  const getReadingRangeStyle = (value: number, min: number, max: number): React.CSSProperties => {
    const normalized = ((value - min) / (max - min)) * 100;
    return {
      '--settings-range-percent': `${Math.max(0, Math.min(100, normalized))}%`,
    } as React.CSSProperties;
  };

  const getReadingSliderPosition = (config: ReadingSliderConfig): number => {
    const currentValue = localReadingLayout[config.key];
    return config.toSliderValue ? config.toSliderValue(currentValue) : currentValue;
  };

  const handleReadingSliderChange = (
    key: ReadingSliderConfig['key'],
    sliderValue: number
  ) => {
    const config = readingSliderConfigs.find((item) => item.key === key);
    const value = config?.fromSliderValue ? config.fromSliderValue(sliderValue) : sliderValue;

    switch (key) {
      case 'fontSize':
        void handleReadingLayoutUpdate({ fontSize: value });
        return;
      case 'lineSpacing':
        void handleReadingLayoutUpdate({ lineSpacing: value });
        return;
      case 'fontWeight':
        void handleReadingLayoutUpdate({ fontWeight: value });
        return;
      case 'characterSpacing':
        void handleReadingLayoutUpdate({ characterSpacing: value });
        return;
      case 'wordSpacing':
        void handleReadingLayoutUpdate({ wordSpacing: value });
        return;
      case 'maxWidth':
        void handleReadingLayoutUpdate({ maxWidth: value });
        return;
      default:
        return;
    }
  };

  const handleExportDiagnostics = async () => {
    if (isExportingReport) {
      return;
    }

    setIsExportingReport(true);
    setReportStatus(null);
    logger.info('Diagnostics', 'Starting diagnostics export from settings');

    try {
      const result = await logger.exportDiagnostics();
      if (result.canceled) {
        setReportStatus('Error report export canceled.');
        logger.info('Diagnostics', 'Diagnostics export canceled from settings');
      } else {
        setReportStatus(`Error report saved to ${result.filePath}`);
        logger.info('Diagnostics', 'Diagnostics export completed from settings', {
          filePath: result.filePath,
        });
      }
    } catch (error) {
      setReportStatus('Failed to export error report.');
      logger.error('Diagnostics', 'Diagnostics export failed from settings', { error });
    } finally {
      setIsExportingReport(false);
    }
  };

  const handleSavedArticlesSyncFolderPick = async () => {
    if (!window.kijiAPI?.pickSavedArticlesSyncFolder || isPickingSavedArticlesSyncFolder) {
      return;
    }

    setIsPickingSavedArticlesSyncFolder(true);
    try {
      const result = await window.kijiAPI.pickSavedArticlesSyncFolder(savedArticlesSyncFolder ?? undefined);
      if (result.canceled || !result.folderPath) {
        return;
      }

      await settingsManager.setSavedArticlesSyncFolder(result.folderPath);
      setSavedArticlesSyncFolder(result.folderPath);

      notifySettingsChanged();
    } catch (error) {
      console.error('Error selecting saved articles sync folder:', error);
    } finally {
      setIsPickingSavedArticlesSyncFolder(false);
    }
  };

  const handleSavedArticlesSyncToggle = async (enabled: boolean) => {
    if (enabled) {
      await handleSavedArticlesSyncFolderPick();
      return;
    }

    try {
      await settingsManager.setSavedArticlesSyncFolder(null);
      setSavedArticlesSyncFolder(null);

      notifySettingsChanged();
    } catch (error) {
      console.error('Error disabling saved articles sync:', error);
    }
  };

  const handleSystemAppIconPick = async () => {
    if (!window.kijiAPI?.pickSystemAppIcon || isPickingSystemAppIcon) {
      return;
    }

    setAppIconStatus(null);
    setIsPickingSystemAppIcon(true);
    try {
      const result = await window.kijiAPI.pickSystemAppIcon();
      if (result.canceled) {
        return;
      }

      setSystemAppIcon(result.state);
      setAppIconStatus('Saved. Relaunch to refresh the Dock icon.');
      notifySettingsChanged();
    } catch (error) {
      setAppIconStatus('Failed to save the custom app icon.');
      console.error('Error selecting app icon:', error);
    } finally {
      setIsPickingSystemAppIcon(false);
    }
  };

  const handleSystemAppIconVariantChange = async (variant: SystemAppIconVariant) => {
    if (!window.kijiAPI?.setSystemAppIconVariant) {
      return;
    }

    setAppIconStatus(null);
    try {
      const nextState = await window.kijiAPI.setSystemAppIconVariant(variant);
      setSystemAppIcon(nextState);
      setAppIconStatus('Saved. Relaunch to refresh the Dock icon.');
      notifySettingsChanged();
    } catch (error) {
      setAppIconStatus('Failed to switch the default app icon.');
      console.error('Error switching default app icon:', error);
    }
  };

  const handleSystemAppIconReset = async () => {
    if (!window.kijiAPI?.resetSystemAppIcon || isResettingSystemAppIcon) {
      return;
    }

    setAppIconStatus(null);
    setIsResettingSystemAppIcon(true);
    try {
      const nextState = await window.kijiAPI.resetSystemAppIcon();
      setSystemAppIcon(nextState);
      setAppIconStatus('Cleared. Relaunch to restore the default Dock icon.');
      notifySettingsChanged();
    } catch (error) {
      setAppIconStatus('Failed to reset the custom app icon.');
      console.error('Error resetting app icon:', error);
    } finally {
      setIsResettingSystemAppIcon(false);
    }
  };

  const handleAppRelaunch = async () => {
    if (!window.kijiAPI?.relaunchApplication || isRelaunching) {
      return;
    }

    setAppIconStatus(null);
    setIsRelaunching(true);
    try {
      await window.kijiAPI.relaunchApplication();
    } catch (error) {
      setAppIconStatus('Failed to relaunch the app.');
      console.error('Error relaunching app:', error);
      setIsRelaunching(false);
    }
  };

  // Route contact actions through the user's default mail app so the email target stays configurable.
  const openMailClient = async (subject: string, body?: string): Promise<void> => {
    if (!window.kijiAPI?.openExternal) {
      throw new Error('openExternal is not available');
    }

    const params = new URLSearchParams({ subject });
    if (body) {
      params.set('body', body);
    }

    await window.kijiAPI.openExternal(`mailto:${CONTACT_EMAIL_ADDRESS}?${params.toString()}`);
  };

  const handleContactEmailOpen = async () => {
    if (isOpeningContactEmail) {
      return;
    }

    setEmailStatus(null);
    setIsOpeningContactEmail(true);
    try {
      await openMailClient(`${APP_NAME} Support`);
      setEmailStatus('Opened your default email client.');
    } catch (error) {
      setEmailStatus('Failed to open your default email client.');
      logger.error('Contact', 'Failed to open support email client', { error });
    } finally {
      setIsOpeningContactEmail(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    const trimmedFeedback = feedbackDraft.trim();
    if (trimmedFeedback.length === 0) {
      setFeedbackStatus('Enter feedback before submitting.');
      return;
    }

    if (isSubmittingFeedback) {
      return;
    }

    setFeedbackStatus(null);
    setIsSubmittingFeedback(true);
    try {
      await openMailClient(`${APP_NAME} Feedback`, trimmedFeedback);
      setFeedbackStatus('Opened your default email client with your feedback draft.');
      setFeedbackDraft('');
    } catch (error) {
      setFeedbackStatus('Failed to open your default email client.');
      logger.error('Contact', 'Failed to open feedback email client', { error });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const renderPane = (title: string, content: React.ReactNode, contentClassName = 'settings-content') => (
    <div className="settings-pane">
      <h2 className="settings-content-title">{title}</h2>
      <div className="settings-main-scroll">
        <div className={contentClassName}>{content}</div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return renderPane('General', (
          <div className="settings-section">
              <section className="settings-group">
                <h3 className="settings-group-title">Sync</h3>
                <div className="settings-group-body">
                  <div className="settings-item settings-item-stacked">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Background feed updates</label>
                      <p className="settings-item-description">
                        How often feeds are automatically checked for new articles
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={backgroundUpdate}
                        onChange={(e) => handleBackgroundUpdateChange(e.target.value as BackgroundUpdateMode)}
                      >
                        <option value="on-launch">When app opens</option>
                        <option value="every-5m">Every 5 minutes</option>
                        <option value="every-10m">Every 10 minutes</option>
                        <option value="every-15m">Every 15 minutes</option>
                        <option value="every-30m">Every 30 minutes</option>
                        <option value="every-1h">Every hour</option>
                        <option value="never">Never</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-item settings-item-stacked">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Content parser</label>
                      <p className="settings-item-description">
                        Engine used to extract clean article text when fetching a page URL.
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={contentParser}
                        onChange={(e) => handleContentParserChange(e.target.value as ContentParser)}
                      >
                        <option value="defuddle">Defuddle (modern, aggressive cleanup)</option>
                        <option value="readability">Readability (Firefox Reader View)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              {/* Keep the saved-article sync row vertically stacked so the folder path and button remain readable. */}
              <section className="settings-group">
                <h3 className="settings-group-title">Store</h3>
                <div className="settings-group-body">
                  <div className="settings-item settings-item-stacked">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Keep saved articles synced to a folder</label>
                      <p className="settings-item-description">
                        Mirror your saved articles as markdown files using the same folder layout as exports.
                      </p>
                      {isSavedArticlesSyncEnabled ? (
                        <p className="settings-inline-path">{savedArticlesSyncFolder}</p>
                      ) : null}
                    </div>
                    <div className="settings-item-control">
                      <label className="settings-switch" aria-label="Enable saved article sync">
                        <input
                          type="checkbox"
                          checked={isSavedArticlesSyncEnabled}
                          onChange={(event) => {
                            void handleSavedArticlesSyncToggle(event.target.checked);
                          }}
                          disabled={isPickingSavedArticlesSyncFolder}
                        />
                        <span className="settings-switch-track">
                          <span className="settings-switch-thumb" />
                        </span>
                      </label>
                      {isSavedArticlesSyncEnabled ? (
                        <button
                          type="button"
                          className="settings-action-button"
                          onClick={() => {
                            void handleSavedArticlesSyncFolderPick();
                          }}
                          disabled={isPickingSavedArticlesSyncFolder}
                        >
                          {isPickingSavedArticlesSyncFolder ? 'Opening...' : 'Change Folder'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
          </div>
        ));
      case 'appearance':
        return renderPane('Appearance', (
          <div className="settings-section">
              <section className="settings-group">
                <h3 className="settings-group-title">Text</h3>
                <div className="settings-group-body">
                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">UI Font</label>
                      <p className="settings-item-description">
                        Font used for sidebar, modals, and interface elements
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={localFonts.uiFont}
                        onChange={(e) => handleFontChange('uiFont', e.target.value)}
                      >
                        {COMMON_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">App Icon</h3>
                <div className="settings-group-body">
                  <div className="settings-item settings-item-stacked">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Default app icon</label>
                      <p className="settings-item-description">
                        Choose the built-in app icon used when no custom icon is selected. Cosmos is the default; picking one clears any custom icon.
                      </p>
                    </div>
                    <div className="settings-app-icon-variant-options" role="group" aria-label="Default app icon">
                      {APP_ICON_VARIANT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`settings-app-icon-variant-option${systemAppIcon.iconVariant === option.value ? ' is-selected' : ''}`}
                          onClick={() => {
                            void handleSystemAppIconVariantChange(option.value);
                          }}
                          disabled={isPickingSystemAppIcon || isResettingSystemAppIcon}
                          aria-pressed={systemAppIcon.iconVariant === option.value}
                        >
                          <span className="settings-app-icon-variant-preview" aria-hidden="true">
                            <img
                              src={option.source}
                              alt=""
                              className="settings-app-icon-image"
                            />
                          </span>
                          <span className="settings-app-icon-variant-label">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-item settings-item-stacked settings-app-icon-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Custom app icon</label>
                      <p className="settings-item-description">
                        Choose a PNG, JPG, ICO, or ICNS file and relaunch to refresh the Dock icon. Finder and packaged
                        .app icons stay set by the build.
                      </p>
                      {appIconStatus ? <p className="settings-inline-status">{appIconStatus}</p> : null}
                    </div>
                    <div className="settings-app-icon-row">
                      <div className="settings-app-icon-preview-group">
                        <div className="settings-app-icon-preview" aria-hidden="true">
                          <img
                            src={systemAppIcon.previewDataUrl ?? getDefaultAppIconPreview(systemAppIcon.iconVariant)}
                            alt="Current app icon preview"
                            className="settings-app-icon-image"
                          />
                        </div>
                        <button
                          type="button"
                          className="settings-icon-button"
                          onClick={() => {
                            void handleSystemAppIconReset();
                          }}
                          disabled={!systemAppIcon.hasCustomIcon || isResettingSystemAppIcon || isPickingSystemAppIcon}
                          title="Reset custom app icon"
                          aria-label="Reset custom app icon"
                        >
                          <ReplayRoundedIcon fontSize="inherit" />
                        </button>
                      </div>
                      <div className="settings-app-icon-actions">
                        <div className="settings-app-icon-text-actions">
                          <button
                            type="button"
                            className="settings-action-button settings-app-icon-action-button"
                            onClick={() => {
                              void handleSystemAppIconPick();
                            }}
                            disabled={isPickingSystemAppIcon || isResettingSystemAppIcon}
                          >
                            <span className="settings-app-icon-action-content">
                              <FileOpenOutlinedIcon fontSize="inherit" />
                              <span>{isPickingSystemAppIcon ? 'Opening...' : 'Choose Icon'}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="settings-action-button settings-action-button-primary settings-app-icon-action-button"
                            onClick={() => {
                              void handleAppRelaunch();
                            }}
                            disabled={isRelaunching}
                          >
                            <span className="settings-app-icon-action-content">
                              <RestartAltOutlinedIcon fontSize="inherit" />
                              <span>{isRelaunching ? 'Relaunching...' : 'Relaunch App'}</span>
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
          </div>
        ));
      case 'reading':
        return renderPane('Reading', (
          <div className="settings-section">
              <section className="settings-group">
                <h3 className="settings-group-title">Fonts</h3>
                <div className="settings-group-body">
                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Article Title Font</label>
                      <p className="settings-item-description">
                        Font used for article titles in the list and the article view header
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={localFonts.articleTitleFont}
                        onChange={(e) => handleFontChange('articleTitleFont', e.target.value)}
                      >
                        {COMMON_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Article Content Font</label>
                      <p className="settings-item-description">
                        Font used for article descriptions and all article body content
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={localFonts.articleContentFont}
                        onChange={(e) => handleFontChange('articleContentFont', e.target.value)}
                      >
                        {COMMON_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">No-ASCII Font</label>
                      <p className="settings-item-description">
                        Font used for non-ASCII text in the article list and article view
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <select
                        className="settings-select"
                        value={localFonts.articleNonAsciiFont}
                        onChange={(e) => handleFontChange('articleNonAsciiFont', e.target.value)}
                      >
                        {CJK_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Layout</h3>
                <div className="settings-group-body">
                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Customize</label>
                      <p className="settings-item-description">
                        Override the default article reading layout with your own spacing, width, and alignment.
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <label className="settings-switch" aria-label="Enable custom reading layout">
                        <input
                          type="checkbox"
                          checked={localReadingLayout.enabled}
                          onChange={(event) => {
                            void handleReadingLayoutUpdate({ enabled: event.target.checked });
                          }}
                        />
                        <span className="settings-switch-track">
                          <span className="settings-switch-thumb" />
                        </span>
                      </label>
                    </div>
                  </div>

                  {readingSliderConfigs.map((config) => (
                    <div
                      key={config.key}
                      className={`settings-reading-slider-row${localReadingLayout.enabled ? '' : ' is-disabled'}`}
                    >
                      <div className="settings-reading-slider-header">
                        <span className="settings-reading-slider-label">{config.label}</span>
                        <span className="settings-reading-slider-value">
                          {config.formatValue(localReadingLayout[config.key])}
                        </span>
                      </div>
                      <div className="settings-reading-slider-control">
                        <span className="settings-reading-slider-icon" aria-hidden="true">
                          {config.icon}
                        </span>
                        <input
                          className="settings-range"
                          type="range"
                          aria-label={config.label}
                          min={config.min}
                          max={config.max}
                          step={config.step}
                          value={getReadingSliderPosition(config)}
                          style={getReadingRangeStyle(getReadingSliderPosition(config), config.min, config.max)}
                          disabled={!localReadingLayout.enabled}
                          onChange={(event) => {
                            handleReadingSliderChange(config.key, Number(event.target.value));
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="settings-item">
                    <div className="settings-item-info">
                      <label className="settings-item-label">Justify Text</label>
                      <p className="settings-item-description">
                        Toggle between left-aligned and justified article body text.
                      </p>
                    </div>
                    <div className="settings-item-control">
                      <StatefulButtonGroup
                        states={justifyButtonStates}
                        currentStateIndex={localReadingLayout.justifyText ? 1 : 0}
                        onChange={(nextStateIndex) => {
                          void handleReadingLayoutUpdate({ justifyText: nextStateIndex === 1 });
                        }}
                        animationConfig={{
                          direction: 'auto',
                          duration: 0,
                        }}
                        className={`settings-reading-justify-button ${localReadingLayout.justifyText ? 'is-active' : ''}`}
                        disabled={!localReadingLayout.enabled}
                      />
                    </div>
                  </div>
                </div>
              </section>
          </div>
        ), 'settings-content settings-content-reading');
      case 'shortcuts':
        return renderPane('Shortcuts', (
          <div className="settings-section">
              {shortcutGroups.map((group) => (
                <section key={group.id} className="settings-group">
                  <h3 className="settings-group-title">{group.title}</h3>
                  <div className="settings-group-body shortcuts-list">
                    {group.items.map((shortcut) => (
                      <div key={shortcut.id} className="shortcut-item">
                        <div className="shortcut-info">
                          <span className="shortcut-label">{shortcut.label}</span>
                        </div>
                        <div className="shortcut-key">{shortcut.current}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        ), 'settings-content-shortcuts');
      case 'contact':
        return renderPane('Contact', (
          <div className="settings-section">
            <section className="settings-group">
              <h3 className="settings-group-title">Email</h3>
              <div className="settings-group-body">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <label className="settings-item-label">Support email</label>
                    <p className="settings-item-description">
                      Opens your default email client with a new message addressed to the app team.
                    </p>
                    {emailStatus ? <p className="settings-inline-status">{emailStatus}</p> : null}
                  </div>
                  <div className="settings-item-control">
                    <button
                      type="button"
                      className="settings-action-button settings-email-button"
                      onClick={() => {
                        void handleContactEmailOpen();
                      }}
                      disabled={isOpeningContactEmail}
                    >
                      {isOpeningContactEmail ? 'Opening...' : CONTACT_EMAIL_ADDRESS}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">Feedback</h3>
              <div className="settings-group-body">
                <div className="settings-item settings-item-stacked">
                  <div className="settings-item-info">
                    <label className="settings-item-label">Share feedback</label>
                    <p className="settings-item-description">
                      Write ideas, suggestions, or issues here and send them through your default email client.
                    </p>
                  </div>
                  <div className="settings-feedback-form">
                    <textarea
                      className="settings-textarea"
                      value={feedbackDraft}
                      onChange={(event) => setFeedbackDraft(event.target.value)}
                      placeholder="Share your feedback here..."
                    />
                    <div className="settings-feedback-actions">
                      <button
                        type="button"
                        className="settings-action-button"
                        onClick={() => {
                          void handleFeedbackSubmit();
                        }}
                        disabled={isSubmittingFeedback}
                      >
                        {isSubmittingFeedback ? 'Opening...' : 'Submit Feedback'}
                      </button>
                    </div>
                    {feedbackStatus ? <p className="settings-inline-status">{feedbackStatus}</p> : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">Diagnostics</h3>
              <div className="settings-group-body">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <label className="settings-item-label">Error report</label>
                    <p className="settings-item-description">
                      Export recent logs and environment details for debugging without sending data automatically.
                    </p>
                    {reportStatus ? <p className="settings-inline-status">{reportStatus}</p> : null}
                  </div>
                  <div className="settings-item-control">
                    <button
                      type="button"
                      className="settings-action-button"
                      onClick={() => {
                        void handleExportDiagnostics();
                      }}
                      disabled={isExportingReport}
                    >
                      {isExportingReport ? 'Exporting...' : 'Export Error Report'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ));
      default:
        return null;
    }
  };

  return (
    <div className="settings-window">
        {/* Content Area */}
        <div className="settings-window-content">
          {/* Left Sidebar - Categories */}
          <div className="settings-sidebar">
            <div
              className="settings-sidebar-top-chrome"
              onMouseDown={handleWindowDragMouseDown}
              aria-hidden="true"
            />
            <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeCategory === 'general' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('general')}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <SettingsIcon fontSize="inherit" />
              </span>
              <span className="settings-nav-label">General</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'appearance' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('appearance')}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <PaletteOutlinedIcon fontSize="inherit" />
              </span>
              <span className="settings-nav-label">Appearance</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'reading' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('reading')}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <MenuBookOutlinedIcon fontSize="inherit" />
              </span>
              <span className="settings-nav-label">Reading</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'shortcuts' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('shortcuts')}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <KeyboardOutlinedIcon fontSize="inherit" />
              </span>
              <span className="settings-nav-label">Shortcuts</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'contact' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('contact')}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <ContactMailOutlinedIcon fontSize="inherit" />
              </span>
              <span className="settings-nav-label">Contact</span>
            </button>
          </nav>
        </div>

        {/* Right Side - Content */}
        <div className="settings-main">{renderContent()}</div>
      </div>
    </div>
  );
};
