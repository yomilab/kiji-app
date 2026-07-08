import React from 'react';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { useAppUpdatePrompt } from '@/hooks/useAppUpdatePrompt';
import './UpdatePromptButton.css';

export const UpdatePromptButton: React.FC = () => {
  const { showBadge, availability, openUpdatePrompt } = useAppUpdatePrompt();

  if (!showBadge || !availability) {
    return null;
  }

  const tooltip = `KiJi ${availability.latestVersion} is available`;

  return (
    <button
      className="button is-text is-small has-no-drag update-prompt-button"
      onClick={() => {
        void openUpdatePrompt(availability);
      }}
      aria-label={tooltip}
      title={tooltip}
      data-widget="app-update"
    >
      <span className="icon update-prompt-icon">
        <SystemUpdateAltIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
        <span className="update-prompt-badge" aria-hidden="true" />
      </span>
    </button>
  );
};
