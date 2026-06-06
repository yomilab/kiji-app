import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { trafficLightVisibilityBus } from '@/services/ui/trafficLightVisibilityBus';
import './TrafficLights.css';

interface TrafficLightsProps {
  visible?: boolean;
}

export const TrafficLights: React.FC<TrafficLightsProps> = ({ visible: visibleProp = true }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [visible, setVisible] = useState(() => trafficLightVisibilityBus.getVisible() && visibleProp);

  useEffect(() => trafficLightVisibilityBus.subscribe((nextVisible) => {
    setVisible(nextVisible && visibleProp);
  }), [visibleProp]);

  useEffect(() => {
    setVisible(trafficLightVisibilityBus.getVisible() && visibleProp);
  }, [visibleProp]);

  const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().close();
  };

  const handleMinimize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().minimize();
  };

  const handleMaximize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().toggleMaximize();
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      className="traffic-lights"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className="traffic-light traffic-light-close"
        onMouseDown={handleClose}
        aria-label="Close window"
      >
        {isHovered && <span className="traffic-light-icon">×</span>}
      </button>
      <button
        type="button"
        className="traffic-light traffic-light-minimize"
        onMouseDown={handleMinimize}
        aria-label="Minimize window"
      >
        {isHovered && <span className="traffic-light-icon">−</span>}
      </button>
      <button
        type="button"
        className="traffic-light traffic-light-maximize"
        onMouseDown={handleMaximize}
        aria-label="Maximize window"
      >
        {isHovered && <span className="traffic-light-icon">+</span>}
      </button>
    </div>
  );
};
