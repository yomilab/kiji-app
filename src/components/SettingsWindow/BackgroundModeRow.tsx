import React, { useRef, useState } from 'react';
import { tauriClient } from '@/lib/tauriClient';
import type { BackgroundModeStatus } from '@/lib/tauriClient/shell';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { subscribeToWindowFocus } from '@/services/tauri/tauriEventSubscription';
import { logger } from '@/services/logger';
import { SettingsRow, SettingsSwitch } from './settingsControls';

const DESCRIPTIONS: Record<BackgroundModeStatus['platform'], string> = {
  macos:
    'KiJi stays in the Dock and keeps checking for new articles, and assistants can still reach it. Click the Dock icon to bring the window back; quit with ⌘Q.',
  windows:
    'KiJi keeps running in the notification area and keeps checking for new articles, and assistants can still reach it. Click its icon to open it again, or right-click it to quit.',
  linux:
    "KiJi keeps running in the system tray and keeps checking for new articles, and assistants can still reach it. Use the tray icon's menu to open or quit it.",
};

const NO_TRAY_NOTICE =
  "Your desktop doesn't show tray icons, so closing the window still quits KiJi.";
const SAVE_FAILED = "Couldn't change this setting. Please try again.";

/** "Keep KiJi running when you close the window" (General pane). */
export const BackgroundModeRow: React.FC = () => {
  const [status, setStatus] = useState<BackgroundModeStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useMountEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      void tauriClient.shell.backgroundMode
        .get()
        .then((next) => {
          if (mountedRef.current) setStatus(next);
        })
        .catch((error) => logger.warn('Settings', 'Failed to read background mode', { error }));
    };
    refresh();
    const unsubscribe = subscribeToWindowFocus(refresh);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  });

  if (!status) return null;

  const onToggle = async (enabled: boolean) => {
    setSaving(true);
    setNotice(null);
    try {
      const next = await tauriClient.shell.backgroundMode.set(enabled);
      if (!mountedRef.current) return;
      setStatus(next);
      if (next.enabled && next.platform !== 'macos' && !next.trayReady) {
        setNotice(NO_TRAY_NOTICE);
      }
    } catch (error) {
      logger.error('Settings', 'Failed to change background mode', { error, enabled });
      if (mountedRef.current) setNotice(SAVE_FAILED);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <SettingsRow
      label="Keep KiJi running when you close the window"
      description={DESCRIPTIONS[status.platform]}
      status={notice}
      control={(
        <SettingsSwitch
          label="Keep KiJi running when you close the window"
          checked={status.enabled}
          disabled={saving}
          onChange={(checked) => void onToggle(checked)}
        />
      )}
    />
  );
};
