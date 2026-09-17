import React from 'react';
import './SyncIndicator.css';

/** Verb x/N copy (`Syncing 3/80 Daily`, `Refreshing 3/12 feeds`, `Clearing 0/4 saved`). */
const FRACTION_INDICATOR_TEXT =
  /^(Refreshing|Syncing|Clearing|Exporting|Importing) (\d+)\/(\d+)(?: (.+))?$/;

const PROGRESS_VIEWBOX = 16;
const PROGRESS_RADIUS = 6;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

interface FractionProgress {
  visible: string;
  percent: number;
}

function parseFractionIndicatorText(text: string): FractionProgress | null {
  const match = FRACTION_INDICATOR_TEXT.exec(text);
  if (!match) {
    return null;
  }

  const verb = match[1];
  const completed = Number(match[2]);
  const total = Number(match[3]);
  const subject = match[4];
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
  const visible = subject ? `${verb} ${subject}` : verb;
  return { visible, percent };
}

export interface SyncIndicatorProps {
  /** Status string (last sync, refresh progress, import/export). Empty still occupies the row. */
  text: string;
  className?: string;
}

/**
 * Left-aligned sidebar status. Intended as a flex sibling of the Settings
 * stack: it shrinks (`min-width: 0`) and ellipsizes as the stack expands left.
 * Winning `x/N` copy becomes a determinate 16px ring plus stripped verb+subject.
 */
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
  text,
  className = '',
}) => {
  const classNames = ['sync-indicator', className].filter(Boolean).join(' ');
  const progress = parseFractionIndicatorText(text);
  const visibleLabel = progress?.visible ?? text;
  const dashLength = progress
    ? (progress.percent / 100) * PROGRESS_CIRCUMFERENCE
    : 0;

  return (
    <p
      className={classNames}
      data-component="sync-indicator"
      title={visibleLabel}
    >
      {progress ? (
        <span
          className="sync-indicator-progress"
          data-slot="sync-indicator-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-label={visibleLabel}
        >
          <svg
            viewBox={`0 0 ${PROGRESS_VIEWBOX} ${PROGRESS_VIEWBOX}`}
            aria-hidden="true"
          >
            <circle
              className="sync-indicator-progress-track"
              cx={PROGRESS_VIEWBOX / 2}
              cy={PROGRESS_VIEWBOX / 2}
              r={PROGRESS_RADIUS}
              fill="none"
            />
            <circle
              className="sync-indicator-progress-arc"
              cx={PROGRESS_VIEWBOX / 2}
              cy={PROGRESS_VIEWBOX / 2}
              r={PROGRESS_RADIUS}
              fill="none"
              strokeDasharray={`${dashLength} ${PROGRESS_CIRCUMFERENCE}`}
            />
          </svg>
        </span>
      ) : null}
      <span className="sync-indicator-text">{visibleLabel}</span>
    </p>
  );
};
