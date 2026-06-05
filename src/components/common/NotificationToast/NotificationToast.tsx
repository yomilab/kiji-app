import React from 'react';
import './NotificationToast.css';

interface NotificationToastProps {
  message: string;
  role?: 'status' | 'alert';
  className?: string;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  message,
  role = 'status',
  className = '',
}) => {
  return (
    <div className={`notification-toast ${className}`.trim()} role={role}>
      {message}
    </div>
  );
};
