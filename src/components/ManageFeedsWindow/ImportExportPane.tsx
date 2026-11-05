import React, { useState } from 'react';
import { LinkGlyph, ShareGlyph, TrayArrowDownGlyph } from '@/components/SettingsWindow/settingsIcons';
import { SettingsGroup, SettingsRow } from '@/components/SettingsWindow/settingsControls';
import { opmlExportService } from '@/services/feeds/opmlExportService';
import { logger } from '@/services/logger';
import type { AppMenuCommand } from '@/types/appMenu';
import { pluralize } from './manageFeedsModel';

export const IMPORT_EXPORT_COPY = {
  mainWindowFailed: 'Couldn’t reach the main window. Try again.',
  exportDone: 'Saved your feeds.',
  exportFailed: 'Couldn’t save the file. Try again.',
  exportUnavailable: 'Saving files isn’t available here.',
} as const;

/**
 * Adding and importing run in the main window: they select the new feed, schedule its first
 * refresh and show sidebar progress there. Export only reads the library, so it runs here.
 */
export async function runInMainWindow(command: AppMenuCommand): Promise<boolean> {
  if (!window.kijiAPI?.runMainWindowCommand) return false;
  try {
    await window.kijiAPI.runMainWindowCommand(command);
    return true;
  } catch (error) {
    logger.error('ManageFeeds', 'Failed to run a command in the main window', { error, command: command.type });
    return false;
  }
}

export const ImportExportPane: React.FC<{ feedCount: number; stationCount: number }> = ({ feedCount, stationCount }) => {
  const [status, setStatus] = useState<{ row: 'add' | 'import' | 'export'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const forward = async (row: 'add' | 'import', command: AppMenuCommand) => {
    setStatus(null);
    if (!(await runInMainWindow(command))) {
      setStatus({ row, text: IMPORT_EXPORT_COPY.mainWindowFailed });
    }
  };

  const exportFeeds = async () => {
    setStatus(null);
    if (!window.kijiAPI?.saveOpmlFile) {
      setStatus({ row: 'export', text: IMPORT_EXPORT_COPY.exportUnavailable });
      return;
    }
    setExporting(true);
    try {
      const opmlText = await opmlExportService.buildOpmlText();
      const result = await window.kijiAPI.saveOpmlFile(opmlText, 'Feeds.opml');
      if (!result.canceled) setStatus({ row: 'export', text: IMPORT_EXPORT_COPY.exportDone });
    } catch (error) {
      logger.error('ManageFeeds', 'Failed to export feeds', { error });
      setStatus({ row: 'export', text: IMPORT_EXPORT_COPY.exportFailed });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mf-pane-body mf-pane-body-settings" data-pane="import-export">
      <div className="settings-main-scroll">
        <div className="settings-content settings-section">
          <SettingsGroup title="Add">
            <SettingsRow
              label="Add a feed"
              description="Paste a link to a site or a feed. Yomi Reader finds the feed and shows a preview first."
              status={status?.row === 'add' ? status.text : null}
              control={(
                <button
                  type="button"
                  className="settings-action-button settings-action-button-primary"
                  onClick={() => { void forward('add', { type: 'openAddSubscription' }); }}
                >
                  <LinkGlyph />
                  Add Feed…
                </button>
              )}
            />
            <SettingsRow
              label="Import from a file"
              description="Bring in subscriptions from an OPML file exported by another reader. Folders become stations."
              status={status?.row === 'import' ? status.text : null}
              control={(
                <button
                  type="button"
                  className="settings-action-button"
                  onClick={() => { void forward('import', { type: 'importFeeds' }); }}
                >
                  <TrayArrowDownGlyph />
                  Import…
                </button>
              )}
            />
          </SettingsGroup>
          <SettingsGroup
            title="Export"
            footer="The file works with most feed readers. Your articles aren’t included."
          >
            <SettingsRow
              label="Export all feeds"
              description={`Save ${pluralize(feedCount, 'feed')} and ${pluralize(stationCount, 'station')} to an OPML file.`}
              status={status?.row === 'export' ? status.text : null}
              control={(
                <button
                  type="button"
                  className="settings-action-button"
                  disabled={exporting || feedCount === 0}
                  onClick={() => { void exportFeeds(); }}
                >
                  <ShareGlyph />
                  {exporting ? 'Exporting…' : 'Export…'}
                </button>
              )}
            />
          </SettingsGroup>
        </div>
      </div>
    </div>
  );
};
