import React from 'react';
import type { AssistantClientId } from '@/lib/tauriClient/assistant';
import {
  BracesGlyph,
  CheckGlyph,
  CodeGlyph,
  CopyGlyph,
  DesktopGlyph,
  DownloadGlyph,
  GridGlyph,
  OpenExternalGlyph,
  SlidersGlyph,
  TerminalGlyph,
  type SettingsGlyphProps,
} from './settingsIcons';

type PrimaryAction = 'extension' | 'install' | 'copy';

export interface AssistantClientRow {
  id: AssistantClientId;
  name: string;
  /** One plain line saying what happens. */
  description: string;
  /** Shown after a successful copy (plain words, no file paths). */
  copiedHint: string;
  primary: PrimaryAction;
  primaryLabel: string;
  Icon: React.FC<SettingsGlyphProps>;
}

export const ASSISTANT_CLIENT_ROWS: AssistantClientRow[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    description: 'Download the extension, then double-click it.',
    copiedHint: "Paste it into Claude's developer settings, then restart Claude.",
    primary: 'extension',
    primaryLabel: 'Download Extension',
    Icon: DesktopGlyph,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Paste the command in Terminal.',
    copiedHint: 'Paste it in Terminal and press Return.',
    primary: 'copy',
    primaryLabel: 'Copy Command',
    Icon: TerminalGlyph,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Opens Cursor so you can add Yomi Reader.',
    copiedHint: "Paste it into Cursor's tool settings.",
    primary: 'install',
    primaryLabel: 'Add to Cursor',
    Icon: CodeGlyph,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Opens VS Code so you can add Yomi Reader.',
    copiedHint: "Paste it into VS Code's tool settings.",
    primary: 'install',
    primaryLabel: 'Add to VS Code',
    Icon: BracesGlyph,
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "Paste the setup into Codex's settings file.",
    copiedHint: "Paste it into Codex's settings file.",
    primary: 'copy',
    primaryLabel: 'Copy Setup',
    Icon: SlidersGlyph,
  },
  {
    id: 'command',
    name: 'Other app',
    description: 'A command for any other assistant app.',
    copiedHint: 'Use it in any assistant app that can run a local tool.',
    primary: 'copy',
    primaryLabel: 'Copy Command',
    Icon: GridGlyph,
  },
];

export type AssistantClientNoticeTarget = AssistantClientId | 'extension' | 'url';

export interface AssistantConnectListProps {
  accessEnabled: boolean;
  notice: { client: AssistantClientNoticeTarget; text: string } | null;
  copiedClient: AssistantClientId | null;
  onDownloadExtension: () => void;
  onOpenInstallLink: (client: AssistantClientId, name: string) => void;
  onCopySetup: (client: AssistantClientId) => void;
}

const noticeFor = (
  row: AssistantClientRow,
  notice: AssistantConnectListProps['notice']
): string => {
  if (!notice) return '';
  if (notice.client === row.id) return notice.text;
  if (row.id === 'claude-desktop' && notice.client === 'extension') return notice.text;
  return '';
};

/** Settings → Assistant → "Connect an Assistant": one row per assistant app. */
export const AssistantConnectList: React.FC<AssistantConnectListProps> = ({
  accessEnabled,
  notice,
  copiedClient,
  onDownloadExtension,
  onOpenInstallLink,
  onCopySetup,
}) => (
  <section className="settings-group assistant-connect" aria-labelledby="assistant-connect-title">
    <h3 className="settings-group-title" id="assistant-connect-title">Connect an Assistant</h3>
    <p className={`assistant-connect-helper${accessEnabled ? '' : ' is-access-off'}`}>
      {accessEnabled
        ? 'Pick the app you use. Yomi Reader needs to be open with access turned on.'
        : 'Access is off. Turn it on above so assistants can connect. You can still set up an app now.'}
    </p>
    <div className={`settings-group-body assistant-client-list${accessEnabled ? '' : ' is-access-off'}`}>
      {ASSISTANT_CLIENT_ROWS.map((row) => {
        const copied = copiedClient === row.id;
        const rowNotice = noticeFor(row, notice);
        const { Icon } = row;
        const copyIcon = copied ? (
          <CheckGlyph className="assistant-client-check" />
        ) : (
          <CopyGlyph />
        );

        const primaryButton = (() => {
          switch (row.primary) {
            case 'extension':
              return (
                <button
                  type="button"
                  className="settings-action-button assistant-compact-button assistant-client-primary"
                  onClick={onDownloadExtension}
                >
                  <DownloadGlyph />
                  <span>{row.primaryLabel}</span>
                </button>
              );
            case 'install':
              return (
                <button
                  type="button"
                  className="settings-action-button assistant-compact-button assistant-client-primary"
                  onClick={() => onOpenInstallLink(row.id, row.name)}
                >
                  <OpenExternalGlyph />
                  <span>{row.primaryLabel}</span>
                </button>
              );
            default:
              return (
                <button
                  type="button"
                  className={`settings-action-button assistant-compact-button assistant-client-primary${copied ? ' is-copied' : ''}`}
                  onClick={() => onCopySetup(row.id)}
                >
                  {copyIcon}
                  <span>{copied ? 'Copied' : row.primaryLabel}</span>
                </button>
              );
          }
        })();

        return (
          <div key={row.id} className="settings-item assistant-client-row" data-client={row.id}>
            <span className="assistant-client-icon" aria-hidden="true">
              <Icon />
            </span>
            <div className="assistant-client-info">
              <span className="assistant-client-name">{row.name}</span>
              <p className="assistant-client-description">{row.description}</p>
              <p className="assistant-client-notice" role="status" aria-live="polite">
                {rowNotice}
              </p>
            </div>
            <div className="assistant-client-actions">
              {primaryButton}
              {row.primary === 'copy' ? (
                <span className="assistant-client-secondary-slot" aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className={`settings-icon-button assistant-client-secondary${copied ? ' is-copied' : ''}`}
                  aria-label={copied ? `Copied setup for ${row.name}` : `Copy setup for ${row.name}`}
                  title={copied ? 'Copied' : 'Copy setup instead'}
                  onClick={() => onCopySetup(row.id)}
                >
                  {copyIcon}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </section>
);
