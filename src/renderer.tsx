import React from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App";
import { ArticleWindow } from "./components/ArticleWindow/ArticleWindow";
import { SettingsWindow } from "./components/SettingsWindow/SettingsWindow";
import { TrafficLights } from "./components/TrafficLights/TrafficLights";
import { FeedProvider } from "./contexts/FeedContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { logger } from "./services/logger";
import { applyFontFamiliesToRoot, applyReadingLayoutToRoot } from "./services/settings/styleVariables";
import { SETTINGS_STORAGE_KEYS } from "./services/settings/storageModel";
import { keybindingService } from "./services/shortcuts/shortcutService";
import { savedArticlesSyncBridge } from "./services/saved/sync/savedArticlesSyncBridge";
import { initializeAppSettings } from "./services/settings/nativeSettingsSync";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { installElectronApiCompat } from "./services/tauri/electronApiCompat";
import { createDeferredUnsubscribe } from "./services/tauri/tauriEventSubscription";
import { installInteractionFreezeWatchdog } from "./services/performance/interactionFreezeWatchdog";
import type { Article } from "./types/article";
import { getRendererWindowType, type RendererWindowType } from "./utils/rendererWindow";
import "./styles/google-sans.css";
import "./styles/golos-text.css";
import "./styles/aktiv-grotesk.css";
import "./styles/theme.css";
import "./styles/framework/index.css";
import "./styles/base.css";
import "./styles/view.css";

function initializeVisualSettings(): void {
  try {
    const settingsJson =
      localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer)
      ?? localStorage.getItem(SETTINGS_STORAGE_KEYS.legacy);
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

function installWindowCloseShortcut(windowType: RendererWindowType): void {
  if (windowType === "main") {
    return;
  }

  keybindingService.register({
    type: "keydown",
    capture: true,
    priority: 1000,
    handler: (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "w") {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void getCurrentWindow().close();
    },
  });
}

const ARTICLE_WINDOW_OPEN_EVENT = "article-window:open";

function ArticleWindowBranch() {
  const [article, setArticle] = React.useState<Article | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const loadArticlePayload = () => {
      setErrorMessage(null);
      void window.electronAPI?.getArticleWindowData()
        .then((payload) => {
          if (mounted) {
            setArticle(payload);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("Renderer", "Failed to load article window payload", { error: message });
          if (mounted) {
            setArticle(null);
            setErrorMessage(message);
          }
        });
    };

    loadArticlePayload();
    const removeOpenListener = createDeferredUnsubscribe(
      listen(ARTICLE_WINDOW_OPEN_EVENT, () => {
        loadArticlePayload();
      }),
    );

    return () => {
      mounted = false;
      removeOpenListener();
    };
  }, []);

  if (errorMessage) {
    return (
      <main className="tauri-window-placeholder">
        <h1>Failed to load article</h1>
        <p>{errorMessage}</p>
      </main>
    );
  }

  if (!article) {
    return (
      <main className="tauri-window-placeholder">
        <h1>Loading article</h1>
        <p>Fetching article data…</p>
      </main>
    );
  }

  return <ArticleWindow article={article} />;
}

function renderWindow(windowType: RendererWindowType): React.ReactElement {
  if (windowType === "settings") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <TrafficLights />
          <SettingsWindow />
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  if (windowType === "article") {
    return (
      <React.StrictMode>
        <ThemeProvider>
          <TrafficLights />
          <ArticleWindowBranch />
        </ThemeProvider>
      </React.StrictMode>
    );
  }

  return (
    <React.StrictMode>
      <ThemeProvider>
        <FeedProvider>
          <TrafficLights />
          <App />
        </FeedProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

async function bootstrapRenderer(): Promise<void> {
  const windowType = getRendererWindowType();
  installElectronApiCompat();
  logger.info("Renderer", "Renderer bootstrap starting", { windowType });

  try {
    await initializeAppSettings();
    if (windowType === "main") {
      try {
        await invoke("shell_main_window_apply_saved_bounds");
      } catch (error) {
        logger.error("Renderer", "Failed to apply saved main window bounds", { error });
      }
    }
  } catch (error: unknown) {
    logger.error("Renderer", "Failed to initialize app settings on bootstrap", { error });
  }

  savedArticlesSyncBridge.start();
  installWindowCloseShortcut(windowType);
  logger.installConsoleCapture(windowType === "main" ? "renderer" : "renderer");
  logger.installGlobalErrorHandlers("renderer");
  installInteractionFreezeWatchdog(windowType ?? "main");
  initializeVisualSettings();

  const container = document.getElementById("root");
  if (!container) {
    logger.error("Renderer", "Root element not found");
    throw new Error("Root element not found");
  }

  createRoot(container).render(renderWindow(windowType));
}

void bootstrapRenderer();
