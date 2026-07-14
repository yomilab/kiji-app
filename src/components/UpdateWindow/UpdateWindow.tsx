import React, { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { APP_NAME } from '@/config/appIdentity';
import { useSecondaryWindowPayload } from '@/hooks/useSecondaryWindowPayload';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import { tauriClient } from '@/lib/tauriClient';
import {
  checkForUpdateDetailed,
  downloadUpdateArtifact,
} from '@/services/system/appUpdateService';
import type {
  UpdateAvailability,
  UpdateWindowPayload,
} from '@/services/system/appUpdateTypes';
import '../AppInfoWindow/AppInfoWindow.css';
import './UpdateWindow.css';

const UPDATE_WINDOW_OPEN_EVENT = 'update-window:open';
const UPDATE_PAYLOAD_TIMEOUT_MS = 3_000;
const ORPHANED_WINDOW_CLOSE_MS = 1_500;

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

function isMissingPayloadError(message: string): boolean {
  return /no update payload was provided/i.test(message);
}

function LoadingGlyph() {
  return <span className="app-info-window-spinner" aria-hidden="true" />;
}

export const UpdateWindow: React.FC = () => {
  // Keep --system-accent-color / --theme-primary in sync for primary CTA.
  useSystemAccentColor();

  const { payload, errorMessage, isLoading, retry } = useSecondaryWindowPayload<UpdateWindowPayload>({
    eventName: UPDATE_WINDOW_OPEN_EVENT,
    loadPayload: () => tauriClient.shell.getUpdateWindowData(),
    logCategory: 'UpdateWindow',
    emptyMessage: 'Failed to load about window payload',
    timeoutMs: UPDATE_PAYLOAD_TIMEOUT_MS,
  });

  const [update, setUpdate] = useState<UpdateAvailability | null>(null);
  const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'up-to-date' | 'error'>('idle');
  const [checkError, setCheckError] = useState<string | null>(null);

  const closeWindow = useCallback(() => {
    void getCurrentWindow().close();
  }, []);

  useEffect(() => {
    if (!errorMessage || !isMissingPayloadError(errorMessage)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      closeWindow();
    }, ORPHANED_WINDOW_CLOSE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [closeWindow, errorMessage]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    if (payload.update) {
      setUpdate(payload.update);
      setCheckStatus('idle');
      setCheckError(null);
      return;
    }

    if (payload.checkOnOpen === false) {
      setUpdate(null);
      setCheckStatus('up-to-date');
      setCheckError(null);
      return;
    }

    let cancelled = false;
    setCheckStatus('loading');
    setCheckError(null);
    setUpdate(null);

    void (async () => {
      const result = await checkForUpdateDetailed();
      if (cancelled) {
        return;
      }
      if (result.status === 'available') {
        setUpdate(result.availability);
        setCheckStatus('idle');
        return;
      }
      if (result.status === 'up-to-date') {
        setUpdate(null);
        setCheckStatus('up-to-date');
        return;
      }
      setUpdate(null);
      setCheckStatus('error');
      setCheckError(result.message ?? 'Could not check for updates.');
    })();

    return () => {
      cancelled = true;
    };
  }, [payload]);

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
    if (!update?.downloadUrl) {
      return;
    }
    void downloadUpdateArtifact(update.downloadUrl);
  };

  const handleOpenNotes = () => {
    if (!update?.notesUrl) {
      return;
    }
    void tauriClient.shell.openExternal({ url: update.notesUrl });
  };

  const handleRetryCheck = () => {
    if (!payload) {
      return;
    }
    setCheckStatus('loading');
    setCheckError(null);
    void (async () => {
      const result = await checkForUpdateDetailed();
      if (result.status === 'available') {
        setUpdate(result.availability);
        setCheckStatus('idle');
        return;
      }
      if (result.status === 'up-to-date') {
        setUpdate(null);
        setCheckStatus('up-to-date');
        return;
      }
      setUpdate(null);
      setCheckStatus('error');
      setCheckError(result.message ?? 'Could not check for updates.');
    })();
  };

  if (errorMessage) {
    const missingPayload = isMissingPayloadError(errorMessage);
    return (
      <main className="app-info-window-placeholder update-window-error" data-window="update-error">
        <h1>{missingPayload ? 'About unavailable' : 'Failed to load'}</h1>
        <p>
          {missingPayload
            ? 'This window was opened without details and will close.'
            : errorMessage}
        </p>
        <div className="app-info-window-actions update-window-error-actions">
          {!missingPayload ? (
            <button
              type="button"
              className="app-info-window-primary-button has-no-drag"
              onClick={retry}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            className="app-info-window-secondary-link has-no-drag"
            onClick={closeWindow}
          >
            Close
          </button>
        </div>
      </main>
    );
  }

  if (isLoading || !payload) {
    return (
      <main className="app-info-window-placeholder" data-window="about-loading">
        <LoadingGlyph />
        <h1>About {APP_NAME}</h1>
        <p>Loading…</p>
      </main>
    );
  }

  const releasedAt = formatReleasedAt(update?.releasedAt);
  const checking = checkStatus === 'loading';

  return (
    <div className="app-info-window update-window" data-window="about">
      <div
        className="app-info-window-top-chrome"
        onMouseDown={handleWindowDragMouseDown}
        data-component="about-window-chrome"
      />
      <div className="app-info-window-body">
        <h1 className="app-info-window-title">About {APP_NAME}</h1>
        <p className="app-info-window-version-line">
          Version {payload.currentVersion}
        </p>

        {checking ? (
          <div className="app-info-window-check-row" role="status" aria-live="polite">
            <LoadingGlyph />
            <span>Checking for updates…</span>
          </div>
        ) : null}

        {!checking && update ? (
          <>
            <p className="app-info-window-version-line">
              {APP_NAME} {update.latestVersion} is available.
              {releasedAt ? ` Released ${releasedAt}.` : ''}
            </p>
            {update.summary ? (
              <p className="app-info-window-summary">{update.summary}</p>
            ) : null}
            <div className="app-info-window-actions">
              <button
                type="button"
                className="app-info-window-primary-button has-no-drag"
                onClick={handleDownload}
              >
                Update {APP_NAME}
              </button>
              {update.notesUrl ? (
                <button
                  type="button"
                  className="app-info-window-secondary-link has-no-drag"
                  onClick={handleOpenNotes}
                >
                  View release notes
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {!checking && !update && checkStatus === 'up-to-date' ? (
          <p className="app-info-window-summary">
            {APP_NAME} is up to date.
          </p>
        ) : null}

        {!checking && checkStatus === 'error' ? (
          <div className="app-info-window-actions">
            <p className="app-info-window-summary">
              {checkError ?? 'Could not check for updates.'}
            </p>
            <button
              type="button"
              className="app-info-window-secondary-link has-no-drag"
              onClick={handleRetryCheck}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
