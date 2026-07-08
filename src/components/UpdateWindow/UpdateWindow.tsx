import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { APP_NAME } from '@/config/appIdentity';
import { useSecondaryWindowPayload } from '@/hooks/useSecondaryWindowPayload';
import { tauriClient } from '@/lib/tauriClient';
import { downloadUpdateArtifact } from '@/services/system/appUpdateService';
import type { UpdateWindowPayload } from '@/services/system/appUpdateTypes';
import '../AppInfoWindow/AppInfoWindow.css';
import './UpdateWindow.css';

const UPDATE_WINDOW_OPEN_EVENT = 'update-window:open';

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

export const UpdateWindow: React.FC = () => {
  const { payload, errorMessage } = useSecondaryWindowPayload<UpdateWindowPayload>({
    eventName: UPDATE_WINDOW_OPEN_EVENT,
    loadPayload: () => tauriClient.shell.getUpdateWindowData(),
    logCategory: 'UpdateWindow',
    emptyMessage: 'Failed to load update window payload',
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

  const handleDownload = () => {
    if (!payload?.downloadUrl) {
      return;
    }
    void downloadUpdateArtifact(payload.downloadUrl);
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
        <h1>Failed to load update</h1>
        <p>{errorMessage}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="app-info-window-placeholder">
        <h1>Loading update</h1>
        <p>Fetching update details…</p>
      </main>
    );
  }

  const releasedAt = formatReleasedAt(payload.releasedAt);

  return (
    <div className="app-info-window update-window" data-window="update">
      <div
        className="app-info-window-top-chrome"
        onMouseDown={handleWindowDragMouseDown}
        data-component="update-window-chrome"
      />
      <div className="app-info-window-body">
        <h1 className="app-info-window-title">Update available</h1>
        <p className="app-info-window-version-line">
          You have {payload.currentVersion}. {APP_NAME} {payload.latestVersion} is available.
          {releasedAt ? ` Released ${releasedAt}.` : ''}
        </p>
        {payload.summary ? (
          <p className="app-info-window-summary">{payload.summary}</p>
        ) : null}
        <div className="app-info-window-actions">
          <button
            type="button"
            className="app-info-window-primary-button has-no-drag"
            onClick={handleDownload}
          >
            Download {APP_NAME} {payload.latestVersion}
          </button>
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
