import React from 'react';
import './SyncIndicator.css';

export interface SyncIndicatorProps {
  /** Status string (last sync, refresh progress, import/export). Empty still occupies the row. */
  text: string;
  /** True when the idle "syncing…" dots animation should run. */
  syncing?: boolean;
  className?: string;
}

/**
 * Right-aligned sidebar status. Intended as a flex sibling of the Settings
 * stack: it shrinks (`min-width: 0`) and clips as the stack expands.
 */
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
  text,
  syncing = false,
  className = '',
}) => {
  const classNames = [
    'sync-indicator',
    syncing ? 'is-syncing' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <p
      className={classNames}
      data-component="sync-indicator"
      title={text}
    >
      {text}
    </p>
  );
};
