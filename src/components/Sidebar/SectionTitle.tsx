import React from 'react';
import './SectionTitle.css';

interface SectionTitleProps {
  title: string;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({ title }) => {
  return (
    <div className="section-title-container">
      <h4 className="section-title-text">{title}</h4>
    </div>
  );
};
