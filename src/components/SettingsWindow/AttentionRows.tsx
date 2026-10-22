import React, { useRef, useState } from 'react';
import { tauriClient } from '@/lib/tauriClient';
import type { AttentionStatus } from '@/lib/tauriClient/shell';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { subscribeToWindowFocus } from '@/services/tauri/tauriEventSubscription';
import { logger } from '@/services/logger';
import { SettingsRow, SettingsSwitch } from './settingsControls';

const BADGE_LABEL = 'Show unread count on app icon';
const NOTIFY_LABEL = 'Notify me about new articles';
const SAVE_FAILED = "Couldn't change this setting. Please try again.";
const NOTIFICATIONS_BLOCKED =
  'Notifications are turned off for KiJi in your system settings. Turn them on there, then try again.';

type AttentionPatch = { showUnreadBadge?: boolean; notifyNewArticles?: boolean };

/** "Show unread count on app icon" and "Notify me about new articles" (General pane). */
export const AttentionRows: React.FC = () => {
  const [status, setStatus] = useState<AttentionStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ row: keyof AttentionPatch; text: string } | null>(null);
  const mountedRef = useRef(true);

  useMountEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      void tauriClient.shell.attention
        .get()
        .then((next) => {
          if (mountedRef.current) setStatus(next);
        })
        .catch((error) => logger.warn('Settings', 'Failed to read badge and notification settings', { error }));
    };
    refresh();
    const unsubscribe = subscribeToWindowFocus(refresh);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  });

  if (!status) return null;

  const save = async (patch: AttentionPatch) => {
    const row = Object.keys(patch)[0] as keyof AttentionPatch;
    setSaving(true);
    setNotice(null);
    try {
      const next = await tauriClient.shell.attention.set(patch);
      if (!mountedRef.current) return;
      setStatus(next);
      if (next.notificationsBlocked) {
        setNotice({ row: 'notifyNewArticles', text: NOTIFICATIONS_BLOCKED });
      }
    } catch (error) {
      logger.error('Settings', 'Failed to change badge or notification setting', { error, patch });
      if (mountedRef.current) setNotice({ row, text: SAVE_FAILED });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const noticeFor = (row: keyof AttentionPatch) => (notice?.row === row ? notice.text : null);

  return (
    <>
      {status.badgeSupported ? (
        <SettingsRow
          label={BADGE_LABEL}
          description="Shows how many articles you haven't read yet, even while the window is closed."
          status={noticeFor('showUnreadBadge')}
          control={(
            <SettingsSwitch
              label={BADGE_LABEL}
              checked={status.showUnreadBadge}
              disabled={saving}
              onChange={(checked) => void save({ showUnreadBadge: checked })}
            />
          )}
        />
      ) : null}
      <SettingsRow
        label={NOTIFY_LABEL}
        description="After KiJi checks your feeds in the background, one notice sums up what's new. Nothing is sent while you're using KiJi."
        status={noticeFor('notifyNewArticles')}
        control={(
          <SettingsSwitch
            label={NOTIFY_LABEL}
            checked={status.notifyNewArticles}
            disabled={saving}
            onChange={(checked) => void save({ notifyNewArticles: checked })}
          />
        )}
      />
    </>
  );
};
