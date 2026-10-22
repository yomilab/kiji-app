import React from 'react';
import { DEFAULT_SETTINGS } from '@/services/settings';
import type { ReadingLayoutSettings } from '@/services/settings';
import { CJK_FONT_OPTIONS, COMMON_FONT_OPTIONS } from '@/services/settings/fontFamilies';
import { getReaderFontSizeBounds } from '@/services/settings/readerTextSize';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from '../settingsControls';
import {
  AlignJustifyGlyph,
  AlignLeftGlyph,
  BoldGlyph,
  LetterSpacingGlyph,
  LineSpacingGlyph,
  TextSizeGlyph,
  TextWidthGlyph,
  WordSpacingGlyph,
} from '../settingsIcons';
import type { FontSettingKey, SettingsWindowState } from '../useSettingsWindowState';

type ReadingSliderKey = 'fontSize' | 'fontWeight' | 'lineSpacing' | 'characterSpacing' | 'wordSpacing' | 'maxWidth';

export interface ReadingSliderConfig {
  key: ReadingSliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  icon: React.ReactNode;
  formatValue: (value: number) => string;
  toSliderValue?: (value: number) => number;
  fromSliderValue?: (value: number) => number;
}

const createSteppedSliderTransform = (
  defaultValue: number,
  stepSize: number,
  precision = 0
): Required<Pick<ReadingSliderConfig, 'toSliderValue' | 'fromSliderValue'>> => ({
  // Keep persisted values and slider offsets in the same discrete step space so remounts
  // always restore the thumb to the exact position the user chose.
  toSliderValue: (value) => Math.round((value - defaultValue) / stepSize),
  fromSliderValue: (value) => Number((defaultValue + (value * stepSize)).toFixed(precision)),
});

const formatDelta = (value: number, defaultValue: number, stepSize: number): string => {
  const delta = Math.round((value - defaultValue) / stepSize);
  return delta === 0 ? 'Default' : `${delta > 0 ? '+' : ''}${delta}`;
};

/** Built per render: DEFAULT_SETTINGS can be swapped by tests and stories. */
export const getReadingSliderConfigs = (): ReadingSliderConfig[] => {
  const defaults = DEFAULT_SETTINGS.readingLayout;
  // Same range as ⌘+ / ⌘− in an article, so the slider can show any size set there.
  const fontSizeBounds = getReaderFontSizeBounds(defaults.fontSize);
  return [
    {
      key: 'fontSize',
      label: 'Font size',
      min: fontSizeBounds.min - defaults.fontSize,
      max: fontSizeBounds.max - defaults.fontSize,
      step: 1,
      icon: <TextSizeGlyph />,
      formatValue: (value) => (
        value === defaults.fontSize
          ? `Default (${Math.round(value)}px)`
          : `${Math.round(value)}px`
      ),
      ...createSteppedSliderTransform(defaults.fontSize, 1),
    },
    {
      key: 'fontWeight',
      label: 'Font weight',
      min: -1,
      max: 5,
      step: 1,
      icon: <BoldGlyph />,
      formatValue: (value) => (
        value === defaults.fontWeight
          ? `Default (${Math.round(value)})`
          : `${Math.round(value)}`
      ),
      ...createSteppedSliderTransform(defaults.fontWeight, 50),
    },
    {
      key: 'lineSpacing',
      label: 'Line spacing',
      min: -9,
      max: 11,
      step: 1,
      icon: <LineSpacingGlyph />,
      formatValue: (value) => formatDelta(value, defaults.lineSpacing, 0.05),
      ...createSteppedSliderTransform(defaults.lineSpacing, 0.05, 2),
    },
    {
      key: 'characterSpacing',
      label: 'Letter spacing',
      min: 0,
      max: 10,
      step: 1,
      icon: <LetterSpacingGlyph />,
      formatValue: (value) => formatDelta(value, defaults.characterSpacing, 1),
    },
    {
      key: 'wordSpacing',
      label: 'Word spacing',
      min: 0,
      max: 20,
      step: 1,
      icon: <WordSpacingGlyph />,
      formatValue: (value) => formatDelta(value, defaults.wordSpacing, 1),
    },
    {
      key: 'maxWidth',
      label: 'Text width',
      min: -16,
      max: 24,
      step: 1,
      icon: <TextWidthGlyph />,
      formatValue: (value) => formatDelta(value, defaults.maxWidth, 10),
      ...createSteppedSliderTransform(defaults.maxWidth, 10),
    },
  ];
};

const FONT_ROWS: ReadonlyArray<{
  key: Exclude<FontSettingKey, 'uiFont'>;
  label: string;
  description: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    key: 'articleTitleFont',
    label: 'Titles',
    description: 'Article titles in the list and at the top of an article.',
    options: COMMON_FONT_OPTIONS,
  },
  {
    key: 'articleContentFont',
    label: 'Body text',
    description: 'Article summaries and the article itself.',
    options: COMMON_FONT_OPTIONS,
  },
  {
    key: 'articleNonAsciiFont',
    label: 'East Asian text',
    description: 'Chinese, Japanese and Korean, in the list and in articles.',
    options: CJK_FONT_OPTIONS,
  },
];

const JUSTIFY_OPTIONS = [
  { value: 'left', label: 'Left', icon: <AlignLeftGlyph /> },
  { value: 'justify', label: 'Justified', icon: <AlignJustifyGlyph /> },
] as const;

export const ReadingPane: React.FC<{ state: SettingsWindowState['reading'] }> = ({ state }) => {
  const layout = state.readingLayout;
  const sliderConfigs = getReadingSliderConfigs();

  const handleSliderChange = (config: ReadingSliderConfig, sliderValue: number) => {
    const value = config.fromSliderValue ? config.fromSliderValue(sliderValue) : sliderValue;
    void state.onReadingLayoutUpdate({ [config.key]: value } as Partial<ReadingLayoutSettings>);
  };

  return (
    <div className="settings-section">
      <SettingsGroup title="Fonts">
        {FONT_ROWS.map((row) => (
          <SettingsRow
            key={row.key}
            label={row.label}
            description={row.description}
            htmlFor={`settings-font-${row.key}`}
            control={(
              <SettingsSelect
                id={`settings-font-${row.key}`}
                value={state.fonts[row.key]}
                onChange={(e) => void state.onFontChange(row.key, e.target.value)}
              >
                {row.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SettingsSelect>
            )}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <SettingsRow
          label="Custom layout"
          description="Set your own text size, spacing, width and alignment."
          control={(
            <SettingsSwitch
              label="Enable custom reading layout"
              checked={layout.enabled}
              onChange={(checked) => {
                void state.onReadingLayoutUpdate({ enabled: checked });
              }}
            />
          )}
        />

        {sliderConfigs.map((config) => {
          const position = config.toSliderValue ? config.toSliderValue(layout[config.key]) : layout[config.key];
          return (
            <SettingsSlider
              key={config.key}
              label={config.label}
              valueText={config.formatValue(layout[config.key])}
              icon={config.icon}
              min={config.min}
              max={config.max}
              step={config.step}
              value={position}
              disabled={!layout.enabled}
              onChange={(value) => handleSliderChange(config, value)}
            />
          );
        })}

        <SettingsRow
          label="Text alignment"
          disabled={!layout.enabled}
          control={(
            <SettingsSegmented
              ariaLabel="Text alignment"
              options={JUSTIFY_OPTIONS}
              value={layout.justifyText ? 'justify' : 'left'}
              disabled={!layout.enabled}
              onChange={(value) => {
                void state.onReadingLayoutUpdate({ justifyText: value === 'justify' });
              }}
            />
          )}
        />
      </SettingsGroup>
    </div>
  );
};
