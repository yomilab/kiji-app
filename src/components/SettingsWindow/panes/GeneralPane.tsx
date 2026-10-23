import React from 'react';
import type { ArticleRetention, ContentParser } from '@/services/settings';
import type { BackgroundUpdateMode } from '@/services/scheduler/types';
import { SettingsGroup, SettingsRow, SettingsSelect, SettingsSwitch } from '../settingsControls';
import { FolderGlyph } from '../settingsIcons';
import { BackgroundModeRow } from '../BackgroundModeRow';
import type { SettingsWindowState } from '../useSettingsWindowState';

export const GeneralPane: React.FC<{ state: SettingsWindowState['general'] }> = ({ state }) => {
  const isSavedArticlesSyncEnabled = state.savedArticlesSyncFolder !== null;

  return (
    <div className="settings-section">
      <SettingsGroup title="Updates">
        <SettingsRow
          label="Check for new articles"
          description="How often KiJi looks for new articles in your feeds."
          htmlFor="settings-background-update"
          control={(
            <SettingsSelect
              id="settings-background-update"
              value={state.backgroundUpdate}
              onChange={(e) => void state.onBackgroundUpdateChange(e.target.value as BackgroundUpdateMode)}
            >
              <option value="on-launch">When app opens</option>
              <option value="every-5m">Every 5 minutes</option>
              <option value="every-10m">Every 10 minutes</option>
              <option value="every-15m">Every 15 minutes</option>
              <option value="every-30m">Every 30 minutes</option>
              <option value="every-1h">Every hour</option>
              <option value="never">Never</option>
            </SettingsSelect>
          )}
        />
        <SettingsRow
          label="Article cleanup"
          description="How KiJi pulls the article text out of a web page."
          htmlFor="settings-content-parser"
          control={(
            <SettingsSelect
              id="settings-content-parser"
              value={state.contentParser}
              onChange={(e) => void state.onContentParserChange(e.target.value as ContentParser)}
            >
              <option value="defuddle">Defuddle (cleans up more)</option>
              <option value="readability">Readability (like Firefox Reader View)</option>
            </SettingsSelect>
          )}
        />
      </SettingsGroup>

      <SettingsGroup title="Storage">
        <SettingsRow
          label="Remove old read articles"
          description="Frees up space by removing articles you've read. Saved, starred, and unread articles are always kept."
          htmlFor="settings-article-retention"
          control={(
            <SettingsSelect
              id="settings-article-retention"
              value={state.articleRetention}
              onChange={(e) => void state.onArticleRetentionChange(e.target.value as ArticleRetention)}
            >
              <option value="never">Never</option>
              <option value="1m">After 1 month</option>
              <option value="3m">After 3 months</option>
              <option value="6m">After 6 months</option>
              <option value="1y">After 1 year</option>
            </SettingsSelect>
          )}
        />
      </SettingsGroup>

      <SettingsGroup title="App">
        <BackgroundModeRow />
      </SettingsGroup>

      <SettingsGroup title="Saved Articles">
        <SettingsRow
          label="Keep a copy in a folder"
          description="Save each saved article as a Markdown file, in the same layout as an export."
          control={(
            <SettingsSwitch
              label="Enable saved article sync"
              checked={isSavedArticlesSyncEnabled}
              disabled={state.isPickingSavedArticlesSyncFolder}
              onChange={(checked) => {
                void state.onSavedArticlesSyncToggle(checked);
              }}
            />
          )}
        />
        {isSavedArticlesSyncEnabled ? (
          <div className="settings-item settings-folder-row">
            <span className="settings-folder-icon" aria-hidden="true">
              <FolderGlyph />
            </span>
            <p className="settings-inline-path" title={state.savedArticlesSyncFolder ?? undefined}>
              {state.savedArticlesSyncFolder}
            </p>
            <button
              type="button"
              className="settings-action-button"
              onClick={() => {
                void state.onSavedArticlesSyncFolderPick();
              }}
              disabled={state.isPickingSavedArticlesSyncFolder}
            >
              {state.isPickingSavedArticlesSyncFolder ? 'Opening…' : 'Change…'}
            </button>
          </div>
        ) : null}
      </SettingsGroup>
    </div>
  );
};
