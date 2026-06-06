import { useEffect, useState } from 'react';

/**
 * Hook to get and monitor system accent color
 *
 * Returns the system accent color (e.g., macOS highlight color)
 * and updates when the system preference changes.
 */
export const useSystemAccentColor = () => {
  const [accentColor, setAccentColor] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const ACCENT_AVAILABLE_CLASS = 'system-accent-color-available';

    const applyAccentColor = (color: string | null) => {
      setAccentColor(color);

      if (color) {
        root.style.setProperty('--system-accent-color', color);
        root.classList.add(ACCENT_AVAILABLE_CLASS);
        return;
      }

      root.style.removeProperty('--system-accent-color');
      root.classList.remove(ACCENT_AVAILABLE_CLASS);
    };

    // Get initial accent color
    const getInitialColor = async () => {
      if (window.electronAPI?.getSystemAccentColor) {
        try {
          const color = await window.electronAPI.getSystemAccentColor();
          applyAccentColor(color);
          console.log('🎨 System accent color:', color ?? 'not available');
        } catch (error) {
          console.error('Failed to get system accent color:', error);
          applyAccentColor(null);
        }
        return;
      }

      applyAccentColor(null);
    };

    getInitialColor();

    // Listen for accent color changes
    if (window.electronAPI?.onSystemAccentColorChanged) {
      return window.electronAPI.onSystemAccentColorChanged((color: string) => {
        applyAccentColor(color);
        console.log('🎨 System accent color changed:', color);
      });
    }
  }, []);

  return accentColor;
};
