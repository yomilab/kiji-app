import { useEffect, useState } from 'react';
import { settingsManager, UserSettings, DEFAULT_SETTINGS } from '@/services/settings';

/**
 * Hook to access and manage user settings
 *
 * Returns the current settings and methods to update them
 */
export const useSettings = () => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loaded = await settingsManager.getSettings();
        setSettings(loaded);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        console.error('Error loading settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  return {
    settings,
    isLoading,
    error,
    updateSettings: settingsManager.saveSettings,
    updateTheme: settingsManager.setTheme,
    updateSidebarWidth: settingsManager.setSidebarWidth,
    updateWindowSize: settingsManager.setWindowSize,
    resetSettings: settingsManager.resetSettings,
  };
};
