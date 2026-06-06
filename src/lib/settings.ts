/**
 * Native app settings persisted by Rust in `user-settings.json`.
 *
 * Keep this file aligned with `src-tauri/src/settings.rs::AppSettings`.
 * Renderer-only preferences (fonts, reading layout, smart views) live in
 * localStorage under `user-settings-ui` — see `services/settings/storageModel.ts`.
 */

export type Theme = "auto" | "light" | "dark";

export type LayoutType = "2-column" | "3-column";

export type BackgroundUpdateMode =
  | "on-launch"
  | "every-5m"
  | "every-10m"
  | "every-15m"
  | "every-30m"
  | "every-1h"
  | "never";

export type ContentParser = "defuddle" | "readability";

export interface WindowSize {
  width: number;
  height: number;
}

export interface AppSettings {
  theme: Theme;
  layout: LayoutType;
  sidebarWidth: number;
  articleListWidth: number;
  windowSize: WindowSize;
  backgroundUpdate: BackgroundUpdateMode;
  contentParser: ContentParser;
  savedArticlesSyncFolder: string | null;
}

export interface AppSettingsPatch {
  theme?: Theme;
  layout?: LayoutType;
  sidebarWidth?: number;
  articleListWidth?: number;
  windowSize?: Partial<WindowSize>;
  backgroundUpdate?: BackgroundUpdateMode;
  contentParser?: ContentParser;
  savedArticlesSyncFolder?: string | null;
}

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const LAYOUT_OPTIONS: ReadonlyArray<{ value: LayoutType; label: string }> = [
  { value: "2-column", label: "2-column" },
  { value: "3-column", label: "3-column" },
];

export const BACKGROUND_UPDATE_OPTIONS: ReadonlyArray<{
  value: BackgroundUpdateMode;
  label: string;
}> = [
  { value: "on-launch", label: "On launch" },
  { value: "every-5m", label: "Every 5 minutes" },
  { value: "every-10m", label: "Every 10 minutes" },
  { value: "every-15m", label: "Every 15 minutes" },
  { value: "every-30m", label: "Every 30 minutes" },
  { value: "every-1h", label: "Every 1 hour" },
  { value: "never", label: "Never" },
];

export const CONTENT_PARSER_OPTIONS: ReadonlyArray<{
  value: ContentParser;
  label: string;
}> = [
  { value: "defuddle", label: "Defuddle" },
  { value: "readability", label: "Readability" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "auto",
  layout: "2-column",
  sidebarWidth: 300,
  articleListWidth: 350,
  windowSize: {
    width: 800,
    height: 600,
  },
  backgroundUpdate: "every-15m",
  contentParser: "defuddle",
  savedArticlesSyncFolder: null,
};

