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

function resolveTheme(theme: AppSettings["theme"]): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(settings: AppSettings): void {
  const resolvedTheme = resolveTheme(settings.theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  localStorage.setItem("user-settings", JSON.stringify(settings));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppSettings["theme"]>("auto");

  useEffect(() => {
    void tauriClient.settings.get().then((settings) => {
      setThemeState(settings.theme);
      applyTheme(settings);
    });
  }, []);

  const setTheme = useCallback(async (nextTheme: AppSettings["theme"]) => {
    const settings = await tauriClient.settings.update({ theme: nextTheme });
    setThemeState(settings.theme);
    applyTheme(settings);
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
