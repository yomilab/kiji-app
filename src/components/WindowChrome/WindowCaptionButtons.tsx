import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './WindowCaptionButtons.css';

interface WindowCaptionButtonsProps {
  className?: string;
}

export const WindowCaptionButtons: React.FC<WindowCaptionButtonsProps> = ({
  className = '',
}) => {
  const handleMinimize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    void getCurrentWindow().minimize();
  };

  const handleMaximize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    void getCurrentWindow().toggleMaximize();
  };

  const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    void getCurrentWindow().close();
  };

  return (
    <div
      className={`window-caption-buttons has-no-drag ${className}`.trim()}
      data-component="window-caption-buttons"
    >
      <button
        type="button"
        className="window-caption-button window-caption-minimize"
        onMouseDown={handleMinimize}
        aria-label="Minimize window"
      >
        <span className="window-caption-icon" aria-hidden="true">
          −
        </span>
      </button>
      <button
        type="button"
        className="window-caption-button window-caption-maximize"
        onMouseDown={handleMaximize}
        aria-label="Maximize window"
      >
        <span className="window-caption-icon" aria-hidden="true">
          □
        </span>
      </button>
      <button
        type="button"
        className="window-caption-button window-caption-close"
        onMouseDown={handleClose}
        aria-label="Close window"
      >
        <span className="window-caption-icon" aria-hidden="true">
          ×
        </span>
      </button>
    </div>
  );
};
