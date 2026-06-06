import React, { useEffect, useState } from 'react';
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

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.windowClose();
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.windowMaximize();
    }
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
        className="traffic-light traffic-light-close"
        onClick={handleClose}
        aria-label="Close window"
      >
        {isHovered && <span className="traffic-light-icon">×</span>}
      </button>
      <button
        className="traffic-light traffic-light-minimize"
        onClick={handleMinimize}
        aria-label="Minimize window"
      >
        {isHovered && <span className="traffic-light-icon">−</span>}
      </button>
      <button
        className="traffic-light traffic-light-maximize"
        onClick={handleMaximize}
        aria-label="Maximize window"
      >
        {isHovered && <span className="traffic-light-icon">+</span>}
      </button>
    </div>
  );
};
