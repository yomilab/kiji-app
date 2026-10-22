import React from 'react';
import './NotificationToast.css';

interface NotificationToastProps {
  message: string;
  role?: 'status' | 'alert';
  className?: string;
  /** Optional button (e.g. Undo); the toast stays click-through elsewhere. */
  actionLabel?: string;
  onAction?: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  message,
  role = 'status',
  className = '',
  actionLabel,
  onAction,
}) => {
  const hasAction = Boolean(actionLabel && onAction);
  return (
    <div
      className={`notification-toast ${hasAction ? 'notification-toast-has-action' : ''} ${className}`.trim()}
      role={role}
    >
      <span className="notification-toast-text">{message}</span>
      {hasAction && (
        <button type="button" className="notification-toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};
