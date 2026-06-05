import React from "react";
import { createRoot } from "react-dom/client";
import { FeedProvider } from "./contexts/FeedContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { logger } from "./services/logger";
import { applyFontFamiliesToRoot, applyReadingLayoutToRoot } from "./services/settings/styleVariables";
import "./styles/google-sans.css";
import "./styles/golos-text.css";
import "./styles/aktiv-grotesk.css";
import "./styles/theme.css";
import "./styles/framework/index.css";
import "./styles/base.css";
import "./styles/view.css";

type RendererWindowType = "main" | "settings" | "article";

function initializeVisualSettings(): void {
  try {
    const settingsJson = localStorage.getItem("user-settings");
    if (!settingsJson) {
      return;
    }

    const settings = JSON.parse(settingsJson) as {
      fontFamilies?: Parameters<typeof applyFontFamiliesToRoot>[0];
      readingLayout?: Parameters<typeof applyReadingLayoutToRoot>[0];
    };

    if (settings.fontFamilies) {
      applyFontFamiliesToRoot(settings.fontFamilies);
    }
    if (settings.readingLayout) {
      applyReadingLayoutToRoot(settings.readingLayout);
    }
  } catch (error) {
    console.error("Error initializing visual settings:", error);
  }
}

function getWindowType(): RendererWindowType {
  const windowType = new URLSearchParams(window.location.search).get("window");
  return windowType === "settings" || windowType === "article" ? windowType : "main";
}

function PlaceholderWindow({ title, body }: { title: string; body: string }) {
  return (
    <main className="tauri-window-placeholder">
      <p className="eyebrow">KiJi Tauri migration</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </main>
  );
}

function renderWindow(windowType: RendererWindowType): React.ReactElement {
  if (windowType === "settings") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <PlaceholderWindow
            title="Settings window bootstrap is ready."
            body="The next window phase will copy the Electron SettingsWindow component and CSS into this renderer branch."
          />
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  if (windowType === "article") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <PlaceholderWindow
            title="Article window bootstrap is ready."
            body="The standalone Electron ArticleWindow flow can now render through ?window=article once the component is copied."
          />
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  return (
    <React.StrictMode>
      <ThemeProvider>
        <FeedProvider>
          <PlaceholderWindow
            title="Main window bootstrap is ready."
            body="The next phase will copy the Electron App, Sidebar, MainArea, article list, article view, shared components, and co-located CSS into this renderer branch."
          />
        </FeedProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

const windowType = getWindowType();
logger.installConsoleCapture(windowType === "main" ? "renderer" : "renderer");
logger.installGlobalErrorHandlers("renderer");
logger.info("Renderer", "Renderer bootstrap starting", { windowType });

initializeVisualSettings();

const container = document.getElementById("root");
if (!container) {
  logger.error("Renderer", "Root element not found");
  throw new Error("Root element not found");
}

createRoot(container).render(renderWindow(windowType));
