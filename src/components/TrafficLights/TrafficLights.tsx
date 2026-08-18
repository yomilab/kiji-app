import React from 'react';
import { isInAppMenuBarOs, readDocumentOs } from '@/services/ui/appMenuModel';
import { WindowCaptionButtons } from '@/components/WindowChrome/WindowCaptionButtons';

interface TrafficLightsProps {
  visible?: boolean;
  /** When true, skip rendering on Windows/Linux (main window uses AppMenuBar captions). */
  hideOnInAppMenuBarOs?: boolean;
}

/**
 * Window controls.
 *
 * macOS uses native AppKit traffic lights (`titleBarStyle: Overlay` in
 * `tauri.macos.conf.json`). This component must not draw fake HTML dots.
 * Windows/Linux stay frameless and keep rectangular caption buttons.
 */
export const TrafficLights: React.FC<TrafficLightsProps> = ({
  hideOnInAppMenuBarOs = false,
}) => {
  const os = readDocumentOs();
  const useWindowsCaptions = isInAppMenuBarOs(os);

  if (!useWindowsCaptions) {
    return null;
  }

  if (hideOnInAppMenuBarOs) {
    return null;
  }

  return <WindowCaptionButtons className="window-caption-buttons-fixed" />;
};
