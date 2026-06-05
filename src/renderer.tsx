import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ArticleWindow } from "./components/ArticleWindow/ArticleWindow";
import { SettingsWindow } from "./components/SettingsWindow/SettingsWindow";
import { FeedProvider } from "./contexts/FeedContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { logger } from "./services/logger";
import { applyFontFamiliesToRoot, applyReadingLayoutToRoot } from "./services/settings/styleVariables";
import { installElectronApiCompat } from "./services/tauri/electronApiCompat";
import type { Article } from "./types/article";
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

function ArticleWindowBranch() {
  const [article, setArticle] = React.useState<Article | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void window.electronAPI?.getArticleWindowData()
      .then((payload) => {
        if (mounted) {
          setArticle(payload);
        }
      })
      .catch((error) => {
        logger.error("Renderer", "Failed to load article window payload", { error });
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!article) {
    return <main className="tauri-window-placeholder">Loading article...</main>;
  }

  return <ArticleWindow article={article} />;
}

function renderWindow(windowType: RendererWindowType): React.ReactElement {
  if (windowType === "settings") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <SettingsWindow />
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  if (windowType === "article") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <FeedProvider>
            <ArticleWindowBranch />
          </FeedProvider>
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  return (
    <React.StrictMode>
      <ThemeProvider>
        <FeedProvider>
          <App />
        </FeedProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

const windowType = getWindowType();
installElectronApiCompat();
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
