import React from 'react';
import './SyncIndicator.css';

export interface SyncIndicatorProps {
  /** Status string (last sync, refresh progress, import/export). Empty still occupies the row. */
  text: string;
  className?: string;
}

/**
 * Left-aligned sidebar status. Intended as a flex sibling of the Settings
 * stack: it shrinks (`min-width: 0`) and ellipsizes as the stack expands left.
 */
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
  text,
  className = '',
}) => {
  const classNames = ['sync-indicator', className].filter(Boolean).join(' ');

  return (
    <p
      className={classNames}
      data-component="sync-indicator"
      title={text}
    >
      <span className="sync-indicator-text">{text}</span>
    </p>
  );
};
