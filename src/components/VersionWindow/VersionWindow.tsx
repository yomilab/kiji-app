import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { APP_DOWNLOADS_URL, APP_NAME } from '@/config/appIdentity';
import { useSecondaryWindowPayload } from '@/hooks/useSecondaryWindowPayload';
import { tauriClient } from '@/lib/tauriClient';
import type { VersionWindowPayload } from '@/services/system/appUpdateTypes';
import '../AppInfoWindow/AppInfoWindow.css';
import './VersionWindow.css';

const VERSION_WINDOW_OPEN_EVENT = 'version-window:open';

function formatReleasedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const VersionWindow: React.FC = () => {
  const { payload, errorMessage } = useSecondaryWindowPayload<VersionWindowPayload>({
    eventName: VERSION_WINDOW_OPEN_EVENT,
    loadPayload: () => tauriClient.shell.getVersionWindowData(),
    logCategory: 'VersionWindow',
    emptyMessage: 'Failed to load version window payload',
  });

  const handleWindowDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.has-no-drag')) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  const handleOpenDownloads = () => {
    void tauriClient.shell.openExternal({ url: APP_DOWNLOADS_URL });
  };

  const handleOpenNotes = () => {
    if (!payload?.notesUrl) {
      return;
    }
    void tauriClient.shell.openExternal({ url: payload.notesUrl });
  };

  if (errorMessage) {
    return (
      <main className="app-info-window-placeholder">
        <h1>Failed to load version</h1>
        <p>{errorMessage}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="app-info-window-placeholder">
        <h1>Loading version</h1>
        <p>Fetching version details…</p>
      </main>
    );
  }

  const releasedAt = formatReleasedAt(payload.releasedAt);
  const statusLine = payload.isUpToDate
    ? `You are on the latest public release.`
    : payload.latestVersion
      ? `A newer version (${payload.latestVersion}) is available.`
      : `Could not reach the public release manifest.`;

  return (
    <div className="app-info-window version-window" data-window="version">
      <div
        className="app-info-window-top-chrome"
        onMouseDown={handleWindowDragMouseDown}
        data-component="version-window-chrome"
      />
      <div className="app-info-window-body">
        <h1 className="app-info-window-title">{APP_NAME} version</h1>
        <p className="app-info-window-version-line">
          Installed: {payload.currentVersion}
          {payload.latestVersion ? ` · Latest: ${payload.latestVersion}` : ''}
          {releasedAt ? ` · Released ${releasedAt}` : ''}
        </p>
        <p className="app-info-window-summary">{statusLine}</p>
        <div className="app-info-window-actions">
          {!payload.isUpToDate ? (
            <button
              type="button"
              className="app-info-window-primary-button has-no-drag"
              onClick={handleOpenDownloads}
            >
              Open downloads page
            </button>
          ) : null}
          {payload.notesUrl ? (
            <button
              type="button"
              className="app-info-window-secondary-link has-no-drag"
              onClick={handleOpenNotes}
            >
              View release notes
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
