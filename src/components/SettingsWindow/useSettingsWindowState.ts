import { useEffect, useRef, useState } from 'react';
import { subscribeToWindowFocus } from '@/services/tauri/tauriEventSubscription';
import { settingsManager, DEFAULT_SETTINGS } from '@/services/settings';
import {
  applySurfaceFillOpacityToRoot,
  beginSurfaceFillDrag,
  clampSurfaceFillOpacity,
  defaultSurfaceFillOpacityForOs,
  endSurfaceFillDrag,
} from '@/services/settings/surfaceFillOpacity';
import type { ArticleRetention, ContentParser, ReadingLayoutSettings, UiThemeVariant } from '@/services/settings';
import type { BackgroundUpdateMode } from '@/services/scheduler/types';
import { DEFAULT_READER_THEME, normalizeReaderTheme } from '@/services/settings/readerThemes';
import {
  DEFAULT_ARTICLE_LIST_DENSITY,
  normalizeArticleListDensity,
  type ArticleListDensity,
} from '@/lib/articleListDensity';
import { useTheme } from '@/contexts/ThemeContext';
import { logger } from '@/services/logger';
import { APP_OFFICIAL_NAME, CONTACT_EMAIL_ADDRESS } from '@/config/appIdentity';
import {
  DEFAULT_SYSTEM_APP_ICON_VARIANT,
  type SystemAppIconState,
  type SystemAppIconVariant,
} from './appIcons';

export type FontSettingKey = 'uiFont' | 'articleTitleFont' | 'articleContentFont' | 'articleNonAsciiFont';

/** Tell the other windows that settings changed; deferred unless `immediate`. */
export const notifySettingsChanged = (immediate = false): void => {
  if (!window.kijiAPI?.notifySettingsChanged) {
    return;
  }

  const emit = () => {
    void window.kijiAPI.notifySettingsChanged().catch((error) => {
      console.error('Error notifying settings change:', error);
    });
  };

  if (immediate) {
    emit();
    return;
  }

  // Keep the settings UI responsive by letting the broadcast and any
  // follow-up sync scheduling happen outside the current interaction turn.
  window.setTimeout(emit, 0);
};

/**
 * Every persisted value and handler the Settings panes use. State lives here, not in the
 * panes, so switching categories never reloads or flickers and an in-flight surface-opacity
 * drag survives a tab switch until the window closes.
 */
export function useSettingsWindowState() {
  const [backgroundUpdate, setBackgroundUpdate] = useState<BackgroundUpdateMode>(
    DEFAULT_SETTINGS.backgroundUpdate,
  );
  const [contentParser, setContentParser] = useState<ContentParser>(DEFAULT_SETTINGS.contentParser);
  const [articleRetention, setArticleRetention] = useState<ArticleRetention>('never');
  const [uiThemeVariant, setUiThemeVariant] = useState<UiThemeVariant>(DEFAULT_SETTINGS.uiThemeVariant);
  const [readerTheme, setReaderTheme] = useState<string>(DEFAULT_READER_THEME);
  const [articleListDensity, setArticleListDensity] = useState<ArticleListDensity>(DEFAULT_ARTICLE_LIST_DENSITY);
  const chromeDefaultFillOpacity = defaultSurfaceFillOpacityForOs(
    typeof document === 'undefined' ? 'macos' : document.documentElement.getAttribute('data-os'),
  );
  const [surfaceFillOpacity, setSurfaceFillOpacity] = useState(chromeDefaultFillOpacity);
  const surfaceFillDraggingRef = useRef(false);
  const surfaceFillDirtyRef = useRef(false);
  const surfaceFillValueRef = useRef(chromeDefaultFillOpacity);
  const surfaceFillCommitLockRef = useRef(false);
  const [savedArticlesSyncFolder, setSavedArticlesSyncFolder] = useState<string | null>(null);
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

  // Load persisted settings on mount and whenever the settings window is shown again.
  useEffect(() => {
    let disposed = false;

    const loadSettings = async () => {
      try {
        const settings = await settingsManager.getSettings();
        if (disposed || surfaceFillDraggingRef.current) {
          return;
        }

        setBackgroundUpdate(settings.backgroundUpdate ?? DEFAULT_SETTINGS.backgroundUpdate);
        setContentParser(settings.contentParser ?? DEFAULT_SETTINGS.contentParser);
        setArticleRetention(settings.articleRetention ?? 'never');
        setUiThemeVariant(settings.uiThemeVariant ?? DEFAULT_SETTINGS.uiThemeVariant);
        setReaderTheme(normalizeReaderTheme(settings.readerTheme));
        setArticleListDensity(normalizeArticleListDensity(settings.articleListDensity));
        const storedFill = clampSurfaceFillOpacity(settings.surfaceFillOpacity);
        const nextFill = storedFill ?? defaultSurfaceFillOpacityForOs(
          document.documentElement.getAttribute('data-os'),
        );
        surfaceFillValueRef.current = nextFill;
        setSurfaceFillOpacity(nextFill);
        applySurfaceFillOpacityToRoot(storedFill);
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

  useEffect(() => {
    const flushSurfaceFillOpacity = () => {
      if (!surfaceFillDirtyRef.current && !surfaceFillCommitLockRef.current) {
        return;
      }

      surfaceFillDirtyRef.current = false;
      surfaceFillDraggingRef.current = false;
      surfaceFillCommitLockRef.current = false;
      endSurfaceFillDrag();
      const value = surfaceFillValueRef.current;
      try {
        settingsManager.setSurfaceFillOpacityNow(value);
        notifySettingsChanged(true);
      } catch (error) {
        console.error('Error saving surface fill opacity:', error);
      }
    };

    const handlePageHide = () => {
      flushSurfaceFillOpacity();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushSurfaceFillOpacity();
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

  const handleArticleRetentionChange = async (retention: ArticleRetention) => {
    try {
      await settingsManager.setArticleRetention(retention);
      setArticleRetention(retention);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving article retention:', error);
    }
  };

  const persistSurfaceFillOpacity = (value: number): void => {
    if (surfaceFillCommitLockRef.current && !surfaceFillDirtyRef.current) {
      return;
    }

    surfaceFillCommitLockRef.current = true;
    surfaceFillDirtyRef.current = false;
    try {
      settingsManager.setSurfaceFillOpacityNow(value);
      notifySettingsChanged(true);
    } catch (error) {
      console.error('Error saving surface fill opacity:', error);
    } finally {
      surfaceFillCommitLockRef.current = false;
      surfaceFillDraggingRef.current = false;
      endSurfaceFillDrag();
    }
  };

  const commitSurfaceFillOpacity = () => {
    if (!surfaceFillDirtyRef.current || surfaceFillCommitLockRef.current) {
      return;
    }

    persistSurfaceFillOpacity(surfaceFillValueRef.current);
  };

  const handleSurfaceFillOpacityInput = (sliderValue: number) => {
    const next = clampSurfaceFillOpacity(sliderValue / 100);
    if (next === undefined) {
      return;
    }

    if (!surfaceFillDraggingRef.current) {
      beginSurfaceFillDrag();
    }
    surfaceFillDraggingRef.current = true;
    surfaceFillDirtyRef.current = true;
    surfaceFillValueRef.current = next;
    setSurfaceFillOpacity(next);
    applySurfaceFillOpacityToRoot(next);
  };

  const handleSurfaceFillOpacityReset = () => {
    const osDefault = defaultSurfaceFillOpacityForOs(
      document.documentElement.getAttribute('data-os'),
    );
    surfaceFillDirtyRef.current = false;
    surfaceFillCommitLockRef.current = false;
    surfaceFillDraggingRef.current = false;
    endSurfaceFillDrag();
    surfaceFillValueRef.current = osDefault;
    setSurfaceFillOpacity(osDefault);
    applySurfaceFillOpacityToRoot(undefined);
    settingsManager.setSurfaceFillOpacityNow(undefined);
    notifySettingsChanged(true);
  };

  const handleUiThemeVariantChange = async (variant: UiThemeVariant) => {
    const previousVariant = uiThemeVariant;
    try {
      // Apply immediately so every window's surface style flips without waiting
      // for the settings-changed round-trip; ThemeContext re-applies on reload.
      setUiThemeVariant(variant);
      document.documentElement.setAttribute('data-ui-theme', variant);
      await settingsManager.setUiThemeVariant(variant);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving UI theme variant:', error);
      setUiThemeVariant(previousVariant);
      document.documentElement.setAttribute('data-ui-theme', previousVariant);
    }
  };

  const handleArticleListDensityChange = async (density: ArticleListDensity) => {
    const previousDensity = articleListDensity;
    try {
      // The main window re-reads density on the settings-changed broadcast.
      setArticleListDensity(density);
      await settingsManager.setArticleListDensity(density);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving article list density:', error);
      setArticleListDensity(previousDensity);
    }
  };

  const handleReaderThemeChange = async (themeId: string) => {
    const previousReaderTheme = readerTheme;
    const nextReaderTheme = normalizeReaderTheme(themeId);
    try {
      // Settings keeps the built-in palette; the main and article windows
      // re-apply through ThemeContext on the settings-changed broadcast.
      setReaderTheme(nextReaderTheme);
      await settingsManager.setReaderTheme(nextReaderTheme);
      notifySettingsChanged();
    } catch (error) {
      console.error('Error saving reader theme:', error);
      setReaderTheme(previousReaderTheme);
    }
  };

  const handleFontChange = async (fontType: FontSettingKey, value: string) => {
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

  const handleReadingLayoutUpdate = async (patch: Partial<ReadingLayoutSettings>) => {
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
      await openMailClient(`${APP_OFFICIAL_NAME} Support`);
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
      await openMailClient(`${APP_OFFICIAL_NAME} Feedback`, trimmedFeedback);
      setFeedbackStatus('Opened your default email client with your feedback draft.');
      setFeedbackDraft('');
    } catch (error) {
      setFeedbackStatus('Failed to open your default email client.');
      logger.error('Contact', 'Failed to open feedback email client', { error });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  return {
    general: {
      backgroundUpdate,
      contentParser,
      articleRetention,
      savedArticlesSyncFolder,
      isPickingSavedArticlesSyncFolder,
      onBackgroundUpdateChange: handleBackgroundUpdateChange,
      onContentParserChange: handleContentParserChange,
      onArticleRetentionChange: handleArticleRetentionChange,
      onSavedArticlesSyncToggle: handleSavedArticlesSyncToggle,
      onSavedArticlesSyncFolderPick: handleSavedArticlesSyncFolderPick,
    },
    appearance: {
      uiFont: localFonts.uiFont,
      uiThemeVariant,
      readerTheme,
      articleListDensity,
      surfaceFillOpacity,
      systemAppIcon,
      appIconStatus,
      isPickingSystemAppIcon,
      isResettingSystemAppIcon,
      isRelaunching,
      onFontChange: handleFontChange,
      onUiThemeVariantChange: handleUiThemeVariantChange,
      onReaderThemeChange: handleReaderThemeChange,
      onArticleListDensityChange: handleArticleListDensityChange,
      onSurfaceFillOpacityInput: handleSurfaceFillOpacityInput,
      onSurfaceFillOpacityCommit: commitSurfaceFillOpacity,
      onSurfaceFillOpacityReset: handleSurfaceFillOpacityReset,
      onSystemAppIconVariantChange: handleSystemAppIconVariantChange,
      onSystemAppIconPick: handleSystemAppIconPick,
      onSystemAppIconReset: handleSystemAppIconReset,
      onAppRelaunch: handleAppRelaunch,
    },
    reading: {
      fonts: localFonts,
      readingLayout: localReadingLayout,
      onFontChange: handleFontChange,
      onReadingLayoutUpdate: handleReadingLayoutUpdate,
    },
    contact: {
      emailStatus,
      feedbackDraft,
      feedbackStatus,
      reportStatus,
      isOpeningContactEmail,
      isSubmittingFeedback,
      isExportingReport,
      onFeedbackDraftChange: setFeedbackDraft,
      onContactEmailOpen: handleContactEmailOpen,
      onFeedbackSubmit: handleFeedbackSubmit,
      onExportDiagnostics: handleExportDiagnostics,
    },
  };
}

export type SettingsWindowState = ReturnType<typeof useSettingsWindowState>;
