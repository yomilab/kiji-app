import React, { useCallback, useRef, useState } from 'react';
import { tauriClient } from '@/lib/tauriClient';
import type {
  AssistantClientId,
  AssistantSettingsPatch,
  AssistantStatus,
} from '@/lib/tauriClient/assistant';
import type { TagRecord } from '@/lib/tauriClient/contracts';
import { useMountEffect } from '@/hooks/useLifecycleEffects';
import { subscribeToWindowFocus } from '@/services/tauri/tauriEventSubscription';
import { logger } from '@/services/logger';
import {
  ASSISTANT_CLIENT_ROWS,
  AssistantConnectList,
  type AssistantClientNoticeTarget,
} from './AssistantConnectList';
import './AssistantSettings.css';

const STATUS_POLL_MS = 3000;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
/** How long a Copy button shows "Copied" before going back to its label. */
export const COPIED_RESET_MS = 2500;

const GENERIC_ERROR = 'Something went wrong. Please try again.';

const formatTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Plain words for the last thing an assistant did (unknown → nothing). */
const ACTION_LABELS: Record<string, string> = {
  get_current_article: 'read the article you had open',
  list_stations: 'listed stations',
  list_feeds: 'listed feeds',
  list_articles: 'listed articles',
  search_articles: 'searched articles',
  get_article: 'read an article',
  get_articles: 'read articles',
  get_digest: 'made a digest',
  list_saved_articles: 'listed saved articles',
  get_saved_article: 'read a saved article',
  'resource:current-article': 'read the article you had open',
  'resource:stations': 'looked at stations',
  'resource:feeds': 'looked at feeds',
  'resource:articles': 'read an article',
  'resource:saved': 'looked at saved articles',
};

const describeAction = (action?: string): string => (action ? ACTION_LABELS[action] ?? '' : '');

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

const Switch: React.FC<SwitchProps> = ({ checked, disabled, label, onChange }) => (
  <label className="settings-switch">
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="settings-switch-track">
      <span className="settings-switch-thumb" />
    </span>
  </label>
);

export const AssistantSettings: React.FC = () => {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  // null until known; false = closing the window quits KiJi.
  const [keepsRunning, setKeepsRunning] = useState<boolean | null>(null);
  const [stations, setStations] = useState<TagRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [clientNotice, setClientNotice] = useState<{ client: AssistantClientNoticeTarget; text: string } | null>(null);
  const [copiedClient, setCopiedClient] = useState<AssistantClientId | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [portDraft, setPortDraft] = useState<string>('');
  const [portNotice, setPortNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await tauriClient.assistant.getStatus();
      if (!mountedRef.current) return;
      setStatus(next);
      setPortDraft((draft) => (draft === '' ? String(next.settings.httpPort) : draft));
    } catch (error) {
      logger.warn('AssistantSettings', 'Failed to read assistant status', { error });
    }
  }, []);

  const refreshBackgroundMode = useCallback(async () => {
    try {
      const mode = await tauriClient.shell.backgroundMode.get();
      if (mountedRef.current) {
        setKeepsRunning(mode.enabled && (mode.platform === 'macos' || mode.trayReady));
      }
    } catch (error) {
      logger.warn('AssistantSettings', 'Failed to read background mode', { error });
    }
  }, []);

  const refreshStations = useCallback(async () => {
    try {
      const tags = await tauriClient.feeds.tags.list();
      if (mountedRef.current) setStations(tags);
    } catch (error) {
      logger.warn('AssistantSettings', 'Failed to read stations', { error });
    }
  }, []);

  useMountEffect(() => {
    mountedRef.current = true;
    void refreshStatus();
    void refreshStations();
    void refreshBackgroundMode();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_MS);
    const unsubscribeFocus = subscribeToWindowFocus(() => {
      void refreshStatus();
      void refreshStations();
      void refreshBackgroundMode();
    });
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      unsubscribeFocus();
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  });

  const update = async (patch: AssistantSettingsPatch): Promise<boolean> => {
    setSaving(true);
    setNotice(null);
    try {
      const next = await tauriClient.assistant.updateSettings(patch);
      if (mountedRef.current) setStatus(next);
      return true;
    } catch (error) {
      logger.error('AssistantSettings', 'Failed to update assistant settings', { error, patch });
      if (mountedRef.current) setNotice(GENERIC_ERROR);
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const showClientNotice = (client: AssistantClientNoticeTarget, text: string) => {
    if (mountedRef.current) setClientNotice({ client, text });
  };

  const markCopied = (client: AssistantClientId) => {
    if (!mountedRef.current) return;
    setCopiedClient(client);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      if (mountedRef.current) setCopiedClient((current) => (current === client ? null : current));
    }, COPIED_RESET_MS);
  };

  const copySetup = async (client: AssistantClientId) => {
    try {
      const setup = await tauriClient.assistant.getClientSetup(client);
      await tauriClient.system.clipboard.writeText({ text: setup.text });
      // App rows use plain words; the app's own hint can name files and folders.
      const plainHint = ASSISTANT_CLIENT_ROWS.find((row) => row.id === client)?.copiedHint ?? setup.hint;
      showClientNotice(client, `Copied. ${plainHint}`);
      markCopied(client);
    } catch (error) {
      const message = typeof error === 'string' && error.startsWith('Turn on') ? error : GENERIC_ERROR;
      showClientNotice(client, message);
      logger.warn('AssistantSettings', 'Failed to copy assistant setup', { error, client });
    }
  };

  const openInstallLink = async (client: AssistantClientId, name: string) => {
    try {
      await tauriClient.assistant.openClientLink(client);
      showClientNotice(client, `Opening ${name}… Confirm there to add KiJi.`);
    } catch (error) {
      showClientNotice(client, `Couldn't open ${name}. Is it installed? You can copy the setup instead.`);
      logger.warn('AssistantSettings', 'Failed to open install link', { error, client });
    }
  };

  const saveExtension = async () => {
    try {
      const result = await tauriClient.shell.dialog.saveFile({
        title: 'Save Claude Desktop Extension',
        fileName: 'KiJi.mcpb',
        filters: [{ name: 'Claude Desktop extension', extensions: ['mcpb'] }],
      });
      if (result.canceled || !result.filePath) return;
      await tauriClient.assistant.writeExtension(result.filePath);
      showClientNotice('extension', 'Saved. Double-click KiJi.mcpb to add it to Claude Desktop.');
    } catch (error) {
      showClientNotice('extension', "Couldn't save the extension. Try another folder.");
      logger.warn('AssistantSettings', 'Failed to save Claude Desktop extension', { error });
    }
  };

  const resetAccess = async () => {
    try {
      const confirmed = await tauriClient.shell.confirmDialog({
        title: 'Reset assistant access?',
        message: 'Every connected assistant is disconnected, and web-address setups you copied before stop working.',
      });
      if (!confirmed) return;
      const next = await tauriClient.assistant.resetAccess();
      if (mountedRef.current) {
        setStatus(next);
        setNotice('Access reset. Assistants that use the app connection reconnect on their own.');
      }
    } catch (error) {
      logger.error('AssistantSettings', 'Failed to reset assistant access', { error });
      if (mountedRef.current) setNotice(GENERIC_ERROR);
    }
  };

  const commitPort = () => {
    const saved = String(status?.settings.httpPort ?? '');
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      setPortNotice(`Choose a port between ${MIN_PORT} and ${MAX_PORT}.`);
      setPortDraft(saved);
      return;
    }
    setPortNotice(null);
    if (port !== status?.settings.httpPort) {
      void update({ httpPort: port }).then((ok) => {
        if (!ok && mountedRef.current) {
          setPortNotice("Couldn't change the port. Please try again.");
          setPortDraft(saved);
        }
      });
    }
  };

  if (!status) {
    return (
      <div className="settings-section">
        <p className="settings-inline-status">Loading…</p>
      </div>
    );
  }

  const { settings } = status;
  const choosingStations = settings.sharedStations !== null;
  const selectedStations = new Set(settings.sharedStations ?? []);
  const accessStatusText = (() => {
    if (!settings.enabled) return null;
    switch (status.local.state) {
      case 'ready':
        return 'Ready. Assistants can connect while KiJi is open.';
      case 'starting':
        return 'Starting…';
      case 'error':
        return status.local.message;
      default:
        return null;
    }
  })();
  const httpStatusText = settings.httpEnabled && status.http.state === 'error' ? status.http.message : null;

  const toggleStation = (name: string, checked: boolean) => {
    const next = new Set(selectedStations);
    if (checked) next.add(name);
    else next.delete(name);
    const ordered = stations.map((station) => station.name).filter((stationName) => next.has(stationName));
    void update({ sharedStations: ordered });
  };

  return (
    <div className="settings-section assistant-settings">
      <section className="settings-group">
        <h3 className="settings-group-title">Access</h3>
        <div className="settings-group-body">
          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Let assistants read your KiJi library</label>
              <p className="settings-item-description">
                AI apps such as Claude, Cursor, or VS Code can read the stations and articles you choose below. They can't change anything unless you allow it.
              </p>
              {accessStatusText ? (
                <p className={`settings-inline-status${status.local.state === 'error' ? ' assistant-status-error' : ''}`}>
                  {accessStatusText}
                </p>
              ) : null}
              {settings.enabled && keepsRunning === false ? (
                <p className="settings-inline-status">
                  Assistants can reach KiJi only while it's running. To keep it available after you close the window, turn on “Keep KiJi running when you close the window” in General.
                </p>
              ) : null}
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.enabled}
                disabled={saving}
                label="Let assistants read your KiJi library"
                onChange={(checked) => void update({ enabled: checked })}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Allow assistants to make changes</label>
              <p className="settings-item-description">
                When you ask, assistants can mark articles read or unread, star them, and save them to Saved. They can't delete anything, and only articles they can see are affected.
              </p>
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.allowChanges}
                disabled={saving || !settings.enabled}
                label="Allow assistants to make changes"
                onChange={(checked) => void update({ allowChanges: checked })}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">What Assistants Can See</h3>
        <div className="settings-group-body">
          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">The article I'm reading</label>
              <p className="settings-item-description">
                The article open in KiJi, so you can ask “explain this” — even if its station isn't shared.
              </p>
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.shareCurrentArticle}
                disabled={saving}
                label="Share the article I'm reading"
                onChange={(checked) => void update({ shareCurrentArticle: checked })}
              />
            </div>
          </div>

          <div className="settings-item settings-item-stacked">
            <div className="settings-item-info">
              <label className="settings-item-label">Stations</label>
              <p className="settings-item-description">Articles from these stations can be listed, searched, and read.</p>
            </div>
            <div className="settings-item-control">
              <select
                className="settings-select"
                aria-label="Stations assistants can see"
                value={choosingStations ? 'chosen' : 'all'}
                disabled={saving}
                onChange={(event) => {
                  const chosen = event.target.value === 'chosen';
                  void update({ sharedStations: chosen ? stations.map((station) => station.name) : null });
                }}
              >
                <option value="all">All stations</option>
                <option value="chosen">Only stations I choose</option>
              </select>
            </div>
            {choosingStations ? (
              <div className="assistant-station-list" role="group" aria-label="Shared stations">
                {stations.length === 0 ? (
                  <p className="settings-item-description">You don't have any stations yet.</p>
                ) : (
                  stations.map((station) => (
                    <label key={station.name} className="assistant-station-option">
                      <input
                        type="checkbox"
                        checked={selectedStations.has(station.name)}
                        disabled={saving}
                        onChange={(event) => toggleStation(station.name, event.target.checked)}
                      />
                      <span className="assistant-station-name">
                        {station.emoji ? `${station.emoji} ` : ''}
                        {station.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Feeds without a station</label>
              <p className="settings-item-description">Include feeds you haven't added to any station.</p>
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.includeUnstationedFeeds}
                disabled={saving}
                label="Share feeds without a station"
                onChange={(checked) => void update({ includeUnstationedFeeds: checked })}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Saved articles</label>
              <p className="settings-item-description">Everything in Saved, whatever station it came from.</p>
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.shareSavedArticles}
                disabled={saving}
                label="Share saved articles"
                onChange={(checked) => void update({ shareSavedArticles: checked })}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Notes and highlights</label>
              <p className="settings-item-description">Your highlights and notes on saved articles.</p>
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.shareNotesAndHighlights}
                disabled={saving}
                label="Share notes and highlights"
                onChange={(checked) => void update({ shareNotesAndHighlights: checked })}
              />
            </div>
          </div>
        </div>
      </section>

      <AssistantConnectList
        accessEnabled={settings.enabled}
        notice={clientNotice}
        copiedClient={copiedClient}
        onDownloadExtension={() => void saveExtension()}
        onOpenInstallLink={(client, name) => void openInstallLink(client, name)}
        onCopySetup={(client) => void copySetup(client)}
      />

      <section className="settings-group">
        <h3 className="settings-group-title">Connected Assistants</h3>
        <div className="settings-group-body">
          {status.clients.length === 0 ? (
            <div className="settings-item">
              <p className="settings-item-description">
                {settings.enabled ? 'No assistant is connected right now.' : 'Turn on access to let assistants connect.'}
              </p>
            </div>
          ) : (
            status.clients.map((client, index) => (
              <div key={`${client.name}-${client.connectedAt}-${index}`} className="settings-item">
                <div className="settings-item-info">
                  <label className="settings-item-label">{client.name}</label>
                  <p className="settings-item-description">
                    {`Connected ${formatTime(client.connectedAt)}`}
                    {client.lastUsedAt ? ` · last used ${formatTime(client.lastUsedAt)}` : ''}
                    {client.lastAction ? ` · ${describeAction(client.lastAction)}` : ''}
                    {client.transport === 'url' ? ' · by web address' : ''}
                  </p>
                </div>
              </div>
            ))
          )}
          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Reset access</label>
              <p className="settings-item-description">Disconnect every assistant and stop old web-address setups from working.</p>
              {notice ? <p className="settings-inline-status" role="status" aria-live="polite">{notice}</p> : null}
            </div>
            <div className="settings-item-control">
              <button type="button" className="settings-action-button assistant-compact-button" onClick={() => void resetAccess()}>
                Reset Access
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">Advanced</h3>
        <div className="settings-group-body">
          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-item-label">Allow connections by web address</label>
              <p className="settings-item-description">
                For assistant apps that only accept a web address. Only apps on this computer can connect, and they need the private key in the copied setup.
              </p>
              {httpStatusText ? <p className="settings-inline-status assistant-status-error">{httpStatusText}</p> : null}
              {clientNotice?.client === 'url' ? <p className="settings-inline-status" role="status" aria-live="polite">{clientNotice.text}</p> : null}
            </div>
            <div className="settings-item-control">
              <Switch
                checked={settings.httpEnabled}
                disabled={saving}
                label="Allow connections by web address"
                onChange={(checked) => void update({ httpEnabled: checked })}
              />
            </div>
          </div>
          {settings.httpEnabled ? (
            <div className="settings-item">
              <div className="settings-item-info">
                <label className="settings-item-label" htmlFor="assistant-port">Port</label>
                <p className="settings-item-description">Change it only if another app already uses this number.</p>
                {portNotice ? <p className="settings-inline-status" role="status" aria-live="polite">{portNotice}</p> : null}
              </div>
              <div className="settings-item-control">
                <input
                  id="assistant-port"
                  className="assistant-port-input"
                  inputMode="numeric"
                  value={portDraft}
                  onChange={(event) => setPortDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                  onBlur={commitPort}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitPort();
                  }}
                />
                <button type="button" className="settings-action-button assistant-compact-button" onClick={() => void copySetup('url')}>
                  Copy Web Address Setup
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <p className="settings-item-description assistant-footer">
        Assistants connect through MCP, an open standard for AI apps. What you share stays on this computer until you ask an assistant about it.
      </p>
    </div>
  );
};
