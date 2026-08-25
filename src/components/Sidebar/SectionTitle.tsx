import React from 'react';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import './SectionTitle.css';

export type SidebarSectionId = 'library' | 'stations';

interface SectionTitleProps {
  title: string;
  sectionId: SidebarSectionId;
  expanded: boolean;
  onToggle: (point: { x: number; y: number }) => void;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({
  title,
  sectionId,
  expanded,
  onToggle,
}) => {
  const toggleLabel = expanded ? `Collapse ${title}` : `Expand ${title}`;

  const handleToggleMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    // Prevent the button from taking focus on click. Focus would keep a
    // `:focus-visible` ring (and keep the chevron “on”) after the pointer leaves.
    event.preventDefault();
  };

  const handleToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle({ x: event.clientX, y: event.clientY });
  };

  return (
    <div
      className="section-title-container"
      data-component="section-title"
      data-section={sectionId}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <h4 className="section-title-text">{title}</h4>
      <button
        type="button"
        className="section-title-toggle"
        onMouseDown={handleToggleMouseDown}
        onClick={handleToggleClick}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-action="toggle-section"
      >
        <span className="section-title-toggle-icon" aria-hidden="true">
          <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
        </span>
      </button>
    </div>
  );
};
