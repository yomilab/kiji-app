import React from 'react';
import { UI_THEME_VARIANT_OPTIONS } from '@/services/settings';
import type { UiThemeVariant } from '@/services/settings';
import { SURFACE_FILL_OPACITY_MAX, SURFACE_FILL_OPACITY_MIN } from '@/services/settings/surfaceFillOpacity';
import { COMMON_FONT_OPTIONS } from '@/services/settings/fontFamilies';
import { DEFAULT_READER_THEME, READER_THEMES } from '@/services/settings/readerThemes';
import { APP_ICON_VARIANT_OPTIONS, getDefaultAppIconPreview } from '../appIcons';
import { ARTICLE_LIST_DENSITY_OPTIONS } from '@/lib/articleListDensity';
import { SettingsGroup, SettingsRow, SettingsSegmented, SettingsSelect, SettingsSlider } from '../settingsControls';
import { DropGlyph, PhotoGlyph, RelaunchGlyph, ResetGlyph } from '../settingsIcons';
import type { SettingsWindowState } from '../useSettingsWindowState';

const OPACITY_MIN = Math.round(SURFACE_FILL_OPACITY_MIN * 100);
const OPACITY_MAX = Math.round(SURFACE_FILL_OPACITY_MAX * 100);

export const AppearancePane: React.FC<{ state: SettingsWindowState['appearance'] }> = ({ state }) => {
  const isIconBusy = state.isPickingSystemAppIcon || state.isResettingSystemAppIcon;
  const opacityPercent = Math.round(state.surfaceFillOpacity * 100);

  return (
    <div className="settings-section">
      <SettingsGroup title="Theme">
        <SettingsRow
          label="Interface style"
          description="Modern uses see-through glass; Classic uses solid colors."
          htmlFor="settings-ui-theme"
          control={(
            <SettingsSelect
              id="settings-ui-theme"
              value={state.uiThemeVariant}
              onChange={(e) => void state.onUiThemeVariantChange(e.target.value as UiThemeVariant)}
            >
              {UI_THEME_VARIANT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SettingsSelect>
          )}
        />
        <SettingsRow
          label="Reader theme"
          description="Book-style colors and fonts for reading."
          htmlFor="reader-theme"
          control={(
            <SettingsSelect
              id="reader-theme"
              value={state.readerTheme}
              onChange={(e) => void state.onReaderThemeChange(e.target.value)}
            >
              <option value={DEFAULT_READER_THEME}>KiJi (default)</option>
              {READER_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id} title={theme.inspiration}>
                  {theme.label}
                </option>
              ))}
            </SettingsSelect>
          )}
        />
        <SettingsSlider
          label="Surface opacity"
          description="Sidebar and Settings sidebar fill."
          valueText={`${opacityPercent}%`}
          icon={<DropGlyph />}
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={1}
          value={opacityPercent}
          onInput={state.onSurfaceFillOpacityInput}
          onCommit={state.onSurfaceFillOpacityCommit}
          onReset={state.onSurfaceFillOpacityReset}
          resetLabel="Reset surface opacity"
        />
      </SettingsGroup>

      <SettingsGroup title="Article List">
        <SettingsRow
          label="Density"
          description="Compact fits more titles; Large Images shows bigger pictures."
          control={(
            <SettingsSegmented
              ariaLabel="Article list density"
              options={ARTICLE_LIST_DENSITY_OPTIONS}
              value={state.articleListDensity}
              onChange={(value) => void state.onArticleListDensityChange(value)}
            />
          )}
        />
      </SettingsGroup>

      <SettingsGroup title="Text">
        <SettingsRow
          label="Interface font"
          description="Used in the sidebar, menus and dialogs."
          htmlFor="settings-ui-font"
          control={(
            <SettingsSelect
              id="settings-ui-font"
              value={state.uiFont}
              onChange={(e) => void state.onFontChange('uiFont', e.target.value)}
            >
              {COMMON_FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SettingsSelect>
          )}
        />
      </SettingsGroup>

      <SettingsGroup title="App Icon">
        <SettingsRow
          label="App icon"
          description="Ripple is the default. Picking one clears a custom icon."
          status={state.appIconStatus}
          stacked
          control={(
            <div className="settings-app-icon-variant-options" role="group" aria-label="Default app icon">
              {APP_ICON_VARIANT_OPTIONS.map((option) => {
                const isSelected = state.systemAppIcon.iconVariant === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`settings-app-icon-variant-option${isSelected ? ' is-selected' : ''}`}
                    onClick={() => {
                      void state.onSystemAppIconVariantChange(option.value);
                    }}
                    disabled={isIconBusy}
                    aria-pressed={isSelected}
                  >
                    <span className="settings-app-icon-variant-preview" aria-hidden="true">
                      <img src={option.source} alt="" className="settings-app-icon-image" />
                    </span>
                    <span className="settings-app-icon-variant-label">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        />
        <div className="settings-item settings-app-icon-item">
          <div className="settings-app-icon-preview" aria-hidden="true">
            <img
              src={state.systemAppIcon.previewDataUrl ?? getDefaultAppIconPreview(state.systemAppIcon.iconVariant)}
              alt=""
              className="settings-app-icon-image"
            />
          </div>
          <div className="settings-item-info">
            <span className="settings-item-label">Custom icon</span>
            <p className="settings-item-description">
              Use your own PNG, JPG, ICO or ICNS image. Relaunch KiJi to see it in the Dock.
            </p>
          </div>
          <div className="settings-item-control settings-app-icon-actions">
            <button
              type="button"
              className="settings-icon-button"
              onClick={() => {
                void state.onSystemAppIconReset();
              }}
              disabled={!state.systemAppIcon.hasCustomIcon || isIconBusy}
              title="Reset custom app icon"
              aria-label="Reset custom app icon"
            >
              <ResetGlyph />
            </button>
            <button
              type="button"
              className="settings-action-button"
              onClick={() => {
                void state.onSystemAppIconPick();
              }}
              disabled={isIconBusy}
            >
              <PhotoGlyph />
              <span>{state.isPickingSystemAppIcon ? 'Opening…' : 'Choose…'}</span>
            </button>
          </div>
        </div>
        <div className="settings-item settings-app-icon-relaunch">
          <div className="settings-item-info">
            <span className="settings-item-label">Relaunch KiJi</span>
            <p className="settings-item-description">The Dock picks up a new icon after a relaunch.</p>
          </div>
          <div className="settings-item-control">
            <button
              type="button"
              className="settings-action-button settings-action-button-primary"
              onClick={() => {
                void state.onAppRelaunch();
              }}
              disabled={state.isRelaunching}
            >
              <RelaunchGlyph />
              <span>{state.isRelaunching ? 'Relaunching…' : 'Relaunch App'}</span>
            </button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
};
