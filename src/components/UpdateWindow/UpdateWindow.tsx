import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTheme } from '@/contexts/ThemeContext';
import { useSecondaryWindowPayload } from '@/hooks/useSecondaryWindowPayload';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import { tauriClient } from '@/lib/tauriClient';
import {
  checkForUpdateDetailed,
  downloadUpdateArtifact,
} from '@/services/system/appUpdateService';
import type { UpdateWindowPayload } from '@/services/system/appUpdateTypes';
import { startWindowDrag } from '@/services/ui/windowDrag';
import { UpdateWindowView, type UpdateWindowStatus } from './UpdateWindowView';

const UPDATE_WINDOW_OPEN_EVENT = 'update-window:open';
const UPDATE_PAYLOAD_TIMEOUT_MS = 3_000;
const ORPHANED_WINDOW_CLOSE_MS = 1_500;
const CHECK_ERROR_FALLBACK = 'Could not check for updates.';

type CheckStatus = Extract<UpdateWindowStatus, { kind: 'checking' | 'available' | 'up-to-date' | 'check-error' }>;

function isMissingPayloadError(message: string): boolean {
  return /no update payload was provided/i.test(message);
}

export const UpdateWindow: React.FC = () => {
  // Keep --system-accent-color / --theme-primary in sync for primary CTA.
  useSystemAccentColor();
  // Reader themes recolor the main window's accent; follow it so the CTA matches.
  const { readerAccent } = useTheme();

  const { payload, errorMessage, isLoading, retry } = useSecondaryWindowPayload<UpdateWindowPayload>({
    eventName: UPDATE_WINDOW_OPEN_EVENT,
    loadPayload: () => tauriClient.shell.getUpdateWindowData(),
    logCategory: 'UpdateWindow',
    emptyMessage: 'Failed to load about window payload',
    timeoutMs: UPDATE_PAYLOAD_TIMEOUT_MS,
  });

  const [checkStatus, setCheckStatus] = useState<CheckStatus>({ kind: 'checking' });
  // Latest check wins; a stale result (payload swapped or retry clicked) is dropped.
  const checkGenerationRef = useRef(0);

  const closeWindow = useCallback(() => {
    void getCurrentWindow().close();
  }, []);

  const runCheck = useCallback(() => {
    const generation = ++checkGenerationRef.current;
    setCheckStatus({ kind: 'checking' });
    void (async () => {
      const result = await checkForUpdateDetailed();
      if (generation !== checkGenerationRef.current) {
        return;
      }
      if (result.status === 'available') {
        setCheckStatus({ kind: 'available', update: result.availability });
      } else if (result.status === 'up-to-date') {
        setCheckStatus({ kind: 'up-to-date' });
      } else {
        setCheckStatus({ kind: 'check-error', message: result.message ?? CHECK_ERROR_FALLBACK });
      }
    })();
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
      checkGenerationRef.current += 1;
      setCheckStatus({ kind: 'available', update: payload.update });
      return;
    }
    if (payload.checkOnOpen === false) {
      checkGenerationRef.current += 1;
      setCheckStatus({ kind: 'up-to-date' });
      return;
    }
    runCheck();
    return () => {
      checkGenerationRef.current += 1;
    };
  }, [payload, runCheck]);

  const handleWindowDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.has-no-drag')) {
      return;
    }
    startWindowDrag();
  };

  const update = checkStatus.kind === 'available' ? checkStatus.update : null;

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

  let status: UpdateWindowStatus;
  if (errorMessage) {
    status = { kind: 'payload-error', message: errorMessage, missingPayload: isMissingPayloadError(errorMessage) };
  } else if (isLoading || !payload) {
    status = { kind: 'loading' };
  } else {
    status = checkStatus;
  }

  return (
    <UpdateWindowView
      currentVersion={payload?.currentVersion}
      status={status}
      readerAccent={readerAccent}
      onDownload={handleDownload}
      onOpenNotes={handleOpenNotes}
      onRetryCheck={runCheck}
      onRetryPayload={retry}
      onClose={closeWindow}
      onWindowDragMouseDown={handleWindowDragMouseDown}
    />
  );
};
