import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/services/settings';
import {
  buildReaderTextSizePatch,
  effectiveReaderFontSize,
  getReaderFontSizeBounds,
  nextReaderFontSize,
  READER_TEXT_SIZE_PERCENT_STEPS,
  readerFontSizeForPercent,
  readerTextSizePercent,
} from '@/services/settings/readerTextSize';
import { getReadingSliderConfigs } from '@/components/SettingsWindow/panes/ReadingPane';

const DEFAULT_SIZE = DEFAULT_SETTINGS.readingLayout.fontSize;

describe('readerTextSize', () => {
  it('steps 10% at a time from 80% to 200% of the default size', () => {
    expect(getReaderFontSizeBounds(18)).toEqual({ min: 14, max: 36 });
    expect(nextReaderFontSize(18, 'bigger', 18)).toBe(20);
    expect(nextReaderFontSize(20, 'bigger', 18)).toBe(22);
    expect(nextReaderFontSize(18, 'smaller', 18)).toBe(16);
    // A slider value between steps moves to the neighbouring step.
    expect(nextReaderFontSize(19, 'bigger', 18)).toBe(20);
    expect(nextReaderFontSize(19, 'smaller', 18)).toBe(18);
  });

  it('clamps at both ends of the range', () => {
    expect(nextReaderFontSize(36, 'bigger', 18)).toBe(36);
    expect(nextReaderFontSize(14, 'smaller', 18)).toBe(14);
    let size = 18;
    for (let index = 0; index < 30; index += 1) size = nextReaderFontSize(size, 'bigger', 18);
    expect(size).toBe(36);
    for (let index = 0; index < 30; index += 1) size = nextReaderFontSize(size, 'smaller', 18);
    expect(size).toBe(14);
  });

  it('resets to the default size', () => {
    expect(nextReaderFontSize(29, 'reset', 18)).toBe(18);
    expect(nextReaderFontSize(14, 'reset', 18)).toBe(18);
  });

  it('labels steps with their round percentage', () => {
    expect(readerTextSizePercent(25, 18)).toBe(140);
    expect(readerTextSizePercent(23, 18)).toBe(130);
    expect(readerTextSizePercent(36, 18)).toBe(200);
    expect(readerTextSizePercent(19, 18)).toBe(106);
  });

  it('uses the default size while custom layout is off', () => {
    const layout = { ...DEFAULT_SETTINGS.readingLayout, enabled: false, fontSize: 24 };
    expect(effectiveReaderFontSize(layout, DEFAULT_SETTINGS.readingLayout)).toBe(DEFAULT_SIZE);
    expect(effectiveReaderFontSize({ ...layout, enabled: true }, DEFAULT_SETTINGS.readingLayout)).toBe(24);
  });

  it('only changes the size when custom layout is on, and keeps on-screen spacing when turning it on', () => {
    const custom = { ...DEFAULT_SETTINGS.readingLayout, enabled: true, lineSpacing: 2 };
    expect(buildReaderTextSizePatch(custom, 22, DEFAULT_SETTINGS.readingLayout)).toEqual({ fontSize: 22 });

    const stashed = { ...DEFAULT_SETTINGS.readingLayout, enabled: false, lineSpacing: 2.3, maxWidth: 900 };
    const onScreen = { ...DEFAULT_SETTINGS.readingLayout, enabled: true, lineSpacing: 1.7 };
    expect(buildReaderTextSizePatch(stashed, 22, onScreen)).toEqual({ ...onScreen, enabled: true, fontSize: 22 });
  });

  it('every step is a position on the Settings font size slider', () => {
    const slider = getReadingSliderConfigs().find((config) => config.key === 'fontSize');
    expect(slider).toBeDefined();
    for (const percent of READER_TEXT_SIZE_PERCENT_STEPS) {
      const size = readerFontSizeForPercent(percent, DEFAULT_SIZE);
      const position = slider!.toSliderValue!(size);
      expect(position).toBeGreaterThanOrEqual(slider!.min);
      expect(position).toBeLessThanOrEqual(slider!.max);
      expect(slider!.fromSliderValue!(position)).toBe(size);
    }
  });
});
