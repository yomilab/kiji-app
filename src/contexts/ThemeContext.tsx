import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { tauriClient } from "../lib/tauriClient";
import type { AppSettings } from "../lib/settings";

export interface ThemeContextValue {
  theme: AppSettings["theme"];
  setTheme: (theme: AppSettings["theme"]) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppSettings["theme"]>("auto");

  useEffect(() => {
    void tauriClient.settings.get().then((settings) => {
      setThemeState(settings.theme);
      document.documentElement.dataset.theme = settings.theme;
    });
  }, []);

  const setTheme = useCallback(async (nextTheme: AppSettings["theme"]) => {
    const settings = await tauriClient.settings.update({ theme: nextTheme });
    setThemeState(settings.theme);
    document.documentElement.dataset.theme = settings.theme;
    await tauriClient.shell.updateMenuState({ theme: settings.theme });
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}
