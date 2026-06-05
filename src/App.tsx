import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  BACKGROUND_UPDATE_OPTIONS,
  CONTENT_PARSER_OPTIONS,
  DEFAULT_SETTINGS,
  LAYOUT_OPTIONS,
  THEME_OPTIONS,
  type AppSettings,
} from "./lib/settings";
import { tauriClient } from "./lib/tauriClient";
import type { DatabaseStatus } from "./lib/tauriClient/contracts";
import "./App.css";

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

function App() {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [persistedSettings, setPersistedSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!persistedSettings) {
      return false;
    }

    return JSON.stringify(draft) !== JSON.stringify(persistedSettings);
  }, [draft, persistedSettings]);

  useEffect(() => {
    void loadSettings();
    void loadDatabaseStatus();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setError(null);

    try {
      const settings = await tauriClient.settings.get();
      setDraft(settings);
      setPersistedSettings(settings);
      setStatus("Loaded the Rust-owned settings snapshot.");
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDatabaseStatus() {
    setDatabaseError(null);

    try {
      setDatabaseStatus(await tauriClient.database.getStatus());
    } catch (loadError) {
      setDatabaseStatus(null);
      setDatabaseError(getErrorMessage(loadError));
    }
  }

  function updateField<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateWindowSizeField(
    key: keyof AppSettings["windowSize"],
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const nextValue = Number(event.currentTarget.value);

    setDraft((current) => ({
      ...current,
      windowSize: {
        ...current.windowSize,
        [key]: Number.isFinite(nextValue) ? nextValue : 0,
      },
    }));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setStatus("Saving settings through Tauri...");

    try {
      const nextSettings = await tauriClient.settings.update({
        ...draft,
        savedArticlesSyncFolder: draft.savedArticlesSyncFolder,
      });
      setDraft(nextSettings);
      setPersistedSettings(nextSettings);
      setStatus("Saved to the Rust-owned config store.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
      setStatus(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    setIsSaving(true);
    setError(null);
    setStatus("Resetting settings...");

    try {
      const nextSettings = await tauriClient.settings.reset();
      setDraft(nextSettings);
      setPersistedSettings(nextSettings);
      setStatus("Reset the settings file back to KiJi defaults.");
    } catch (resetError) {
      setError(getErrorMessage(resetError));
      setStatus(null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">KiJi migration slice</p>
        <h1>Rust-owned settings are now the first real Tauri domain.</h1>
        <p className="hero-copy">
          This workspace no longer uses the scaffolded greet demo. The renderer now
          loads and saves real KiJi settings through typed Tauri commands backed by
          a JSON settings file in the native app config directory.
        </p>
        <div className="hero-metadata">
          <span>Domain: settings.get / settings.update / settings.reset</span>
          <span>Storage: user-settings.json in the app config directory</span>
          <span>Scope today: theme, layout, widths, window size, refresh mode, parser, sync path</span>
        </div>
      </section>

      <section className="status-row" aria-live="polite">
        {isLoading ? <p className="status status--info">Loading settings...</p> : null}
        {!isLoading && status ? <p className="status status--success">{status}</p> : null}
        {error ? <p className="status status--error">{error}</p> : null}
        {databaseError ? <p className="status status--error">{databaseError}</p> : null}
      </section>

      <section className="settings-card settings-card--wide">
        <h2>Database foundation</h2>
        {databaseStatus ? (
          <dl className="metadata-list">
            <div>
              <dt>Path</dt>
              <dd>{databaseStatus.path}</dd>
            </div>
            <div>
              <dt>Migration ledger</dt>
              <dd>
                {databaseStatus.currentMigrationVersion} / {databaseStatus.schemaVersion}
              </dd>
            </div>
            <div>
              <dt>Journal mode</dt>
              <dd>{databaseStatus.journalMode}</dd>
            </div>
            <div>
              <dt>Foreign keys</dt>
              <dd>{databaseStatus.foreignKeysEnabled ? "Enabled" : "Disabled"}</dd>
            </div>
          </dl>
        ) : (
          <p className="card-note">Loading the Rust-owned database status...</p>
        )}
        <p className="card-note">
          This opens the future KiJi SQLite database with WAL and foreign keys. Schema migrations and
          repository commands are the next database slice.
        </p>
      </section>

      <form className="settings-grid" onSubmit={handleSave}>
        <section className="settings-card">
          <h2>Display</h2>
          <label className="field">
            <span>Theme</span>
            <select
              value={draft.theme}
              onChange={(event) => updateField("theme", event.currentTarget.value as AppSettings["theme"])}
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Layout</span>
            <select
              value={draft.layout}
              onChange={(event) => updateField("layout", event.currentTarget.value as AppSettings["layout"])}
            >
              {LAYOUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card">
          <h2>Library sizing</h2>
          <label className="field">
            <span>Sidebar width</span>
            <input
              min={1}
              type="number"
              value={draft.sidebarWidth}
              onChange={(event) => updateField("sidebarWidth", Number(event.currentTarget.value))}
            />
          </label>
          <label className="field">
            <span>Article list width</span>
            <input
              min={1}
              type="number"
              value={draft.articleListWidth}
              onChange={(event) => updateField("articleListWidth", Number(event.currentTarget.value))}
            />
          </label>
        </section>

        <section className="settings-card">
          <h2>Window state</h2>
          <label className="field">
            <span>Window width</span>
            <input
              min={1}
              type="number"
              value={draft.windowSize.width}
              onChange={(event) => updateWindowSizeField("width", event)}
            />
          </label>
          <label className="field">
            <span>Window height</span>
            <input
              min={1}
              type="number"
              value={draft.windowSize.height}
              onChange={(event) => updateWindowSizeField("height", event)}
            />
          </label>
          <p className="card-note">
            The Tauri settings slice persists the future shell restore size now; later window work will apply it at startup.
          </p>
        </section>

        <section className="settings-card">
          <h2>Background behavior</h2>
          <label className="field">
            <span>Feed refresh cadence</span>
            <select
              value={draft.backgroundUpdate}
              onChange={(event) =>
                updateField(
                  "backgroundUpdate",
                  event.currentTarget.value as AppSettings["backgroundUpdate"],
                )
              }
            >
              {BACKGROUND_UPDATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Content parser</span>
            <select
              value={draft.contentParser}
              onChange={(event) =>
                updateField(
                  "contentParser",
                  event.currentTarget.value as AppSettings["contentParser"],
                )
              }
            >
              {CONTENT_PARSER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card settings-card--wide">
          <h2>Saved article sync</h2>
          <label className="field">
            <span>Sync folder path</span>
            <input
              placeholder="Leave blank to disable mirror sync"
              type="text"
              value={draft.savedArticlesSyncFolder ?? ""}
              onChange={(event) =>
                updateField("savedArticlesSyncFolder", event.currentTarget.value || null)
              }
            />
          </label>
          <p className="card-note">
            Folder picking still belongs to a later shell/filesystem migration task. This slice proves the persisted nullable path contract first.
          </p>
        </section>

        <section className="actions-row">
          <button disabled={isSaving || isLoading || !hasUnsavedChanges} type="submit">
            {isSaving ? "Saving..." : "Save settings"}
          </button>
          <button
            className="button-secondary"
            disabled={isSaving || isLoading}
            onClick={handleReset}
            type="button"
          >
            Reset defaults
          </button>
          <button
            className="button-secondary"
            disabled={isSaving}
            onClick={() => void loadSettings()}
            type="button"
          >
            Reload from disk
          </button>
        </section>
      </form>
    </main>
  );
}

export default App;
