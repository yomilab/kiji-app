import React from 'react';
import circleAppIcon from '@/assets/images/kiji-logo-circle.png';
import { APP_OFFICIAL_NAME } from '@/config/appIdentity';
import type { ReaderAccent } from '@/contexts/ThemeContext';
import type { ReleaseNotesSection, UpdateAvailability } from '@/services/system/appUpdateTypes';
import './UpdateWindow.css';

/** Everything the About / update window can show; the container maps runtime state onto it. */
export type UpdateWindowStatus =
  | { kind: 'loading' }
  | { kind: 'payload-error'; message: string; missingPayload: boolean }
  | { kind: 'checking' }
  | { kind: 'available'; update: UpdateAvailability }
  | { kind: 'up-to-date' }
  | { kind: 'check-error'; message: string };

export interface UpdateWindowViewProps {
  currentVersion?: string;
  status: UpdateWindowStatus;
  /**
   * Active reader theme: scopes its `--rt-*` tokens to this window so the
   * primary color matches the main window, while the palette stays built-in.
   */
  readerAccent?: ReaderAccent | null;
  /** Defaults to the packaged Circle icon. */
  appIconSrc?: string;
  onDownload?: () => void;
  onOpenNotes?: () => void;
  onRetryCheck?: () => void;
  onRetryPayload?: () => void;
  onClose?: () => void;
  onWindowDragMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function formatReleasedAt(value: string | undefined): string | null {
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

function Spinner() {
  return <span className="update-window-spinner" aria-hidden="true" />;
}

function StatusDot({ tone }: { tone: 'success' | 'accent' | 'warning' }) {
  return <span className={`update-window-status-dot is-${tone}`} aria-hidden="true" />;
}

function ReleaseNotesList({ sections }: { sections: ReleaseNotesSection[] }) {
  return (
    <div
      className="update-window-notes has-no-drag"
      // Keyboard users can scroll a long list.
      tabIndex={0}
      aria-label="What’s new"
      data-component="update-release-notes"
    >
      {sections.map((section) => (
        <section key={section.title} className="update-window-notes-section">
          <h2 className="update-window-notes-title">{section.title}</h2>
          <ul className="update-window-notes-list">
            {section.items.map((item, index) => (
              // Items can repeat across releases but not within one section's order.
              <li key={`${index}:${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UpdateStatusPanel({ status }: { status: UpdateWindowStatus }) {
  switch (status.kind) {
    case 'checking':
      return (
        <div className="update-window-panel" role="status" aria-live="polite" data-update-state="checking">
          <div className="update-window-panel-row">
            <Spinner />
            <span className="update-window-panel-title">Checking for updates…</span>
          </div>
        </div>
      );
    case 'up-to-date':
      return (
        <div className="update-window-panel" role="status" data-update-state="up-to-date">
          <div className="update-window-panel-row">
            <StatusDot tone="success" />
            <span className="update-window-panel-title">You’re up to date</span>
          </div>
          <p className="update-window-panel-text">
            {APP_OFFICIAL_NAME} is running the latest version.
          </p>
        </div>
      );
    case 'check-error':
      return (
        <div className="update-window-panel" role="alert" data-update-state="error">
          <div className="update-window-panel-row">
            <StatusDot tone="warning" />
            <span className="update-window-panel-title">Couldn’t check for updates</span>
          </div>
          <p className="update-window-panel-text">{status.message}</p>
        </div>
      );
    case 'available': {
      const releasedAt = formatReleasedAt(status.update.releasedAt);
      // Payloads from older callers may predate `sections`.
      const sections = status.update.sections ?? [];
      return (
        <div
          className={`update-window-panel is-highlighted${sections.length ? ' has-notes' : ''}`}
          role="status"
          data-update-state="available"
        >
          <div className="update-window-panel-row">
            <StatusDot tone="accent" />
            <span className="update-window-panel-title">
              Version {status.update.latestVersion} is available
            </span>
            {releasedAt ? (
              <span className="update-window-panel-meta">{releasedAt}</span>
            ) : null}
          </div>
          {status.update.summary ? (
            <p className={`update-window-panel-text${sections.length ? '' : ' is-clamped'}`}>
              {status.update.summary}
            </p>
          ) : null}
          {sections.length ? <ReleaseNotesList sections={sections} /> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

function UpdateActions({
  status,
  onDownload,
  onOpenNotes,
  onRetryCheck,
  onClose,
}: Pick<UpdateWindowViewProps, 'onDownload' | 'onOpenNotes' | 'onRetryCheck' | 'onClose'> & {
  status: UpdateWindowStatus;
}) {
  if (status.kind === 'available') {
    return (
      <div className="update-window-actions">
        {status.update.notesUrl ? (
          <button type="button" className="update-window-button is-secondary has-no-drag" onClick={onOpenNotes}>
            Full Changelog
          </button>
        ) : null}
        <button type="button" className="update-window-button is-primary has-no-drag" onClick={onDownload}>
          Download Update
        </button>
      </div>
    );
  }
  if (status.kind === 'check-error') {
    return (
      <div className="update-window-actions">
        <button type="button" className="update-window-button is-secondary has-no-drag" onClick={onClose}>
          Close
        </button>
        <button type="button" className="update-window-button is-primary has-no-drag" onClick={onRetryCheck}>
          Try Again
        </button>
      </div>
    );
  }
  if (status.kind === 'up-to-date') {
    return (
      <div className="update-window-actions">
        <button type="button" className="update-window-button is-secondary has-no-drag" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }
  return null;
}

export const UpdateWindowView: React.FC<UpdateWindowViewProps> = ({
  currentVersion,
  status,
  appIconSrc = circleAppIcon,
  readerAccent,
  onDownload,
  onOpenNotes,
  onRetryCheck,
  onRetryPayload,
  onClose,
  onWindowDragMouseDown,
}) => {
  const accentAttributes = readerAccent
    ? { 'data-reader-theme': readerAccent.themeId, 'data-reader-scheme': readerAccent.scheme }
    : {};

  if (status.kind === 'payload-error') {
    return (
      <main
        className="update-window update-window-placeholder"
        data-window="update-error"
        {...accentAttributes}
        onMouseDown={onWindowDragMouseDown}
      >
        <StatusDot tone="warning" />
        <h1 className="update-window-placeholder-title">
          {status.missingPayload ? 'About unavailable' : 'Failed to load'}
        </h1>
        <p className="update-window-placeholder-text">
          {status.missingPayload
            ? 'This window was opened without details and will close.'
            : status.message}
        </p>
        <div className="update-window-actions is-centered">
          <button type="button" className="update-window-button is-secondary has-no-drag" onClick={onClose}>
            Close
          </button>
          {!status.missingPayload ? (
            <button type="button" className="update-window-button is-primary has-no-drag" onClick={onRetryPayload}>
              Retry
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  if (status.kind === 'loading') {
    return (
      <main
        className="update-window update-window-placeholder"
        data-window="about-loading"
        {...accentAttributes}
        onMouseDown={onWindowDragMouseDown}
      >
        <Spinner />
        <p className="update-window-placeholder-text">Loading…</p>
      </main>
    );
  }

  return (
    <div
      className="update-window"
      data-window="about"
      onMouseDown={onWindowDragMouseDown}
      {...accentAttributes}
    >
      <div className="update-window-chrome" data-component="about-window-chrome" />
      <div className="update-window-body">
        <header className="update-window-header">
          <img className="update-window-icon" src={appIconSrc} alt="" draggable={false} />
          <div className="update-window-identity">
            <h1 className="update-window-title">{APP_OFFICIAL_NAME}</h1>
            {currentVersion ? (
              <p className="update-window-version">Version {currentVersion}</p>
            ) : null}
          </div>
        </header>
        <UpdateStatusPanel status={status} />
        <UpdateActions
          status={status}
          onDownload={onDownload}
          onOpenNotes={onOpenNotes}
          onRetryCheck={onRetryCheck}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
