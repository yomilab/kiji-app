import type { ReadingLayoutSettings } from './types';

/**
 * Quick article text size (⌘+ / ⌘− / ⌘0). Steps are percentages of the
 * default body size and land on whole pixels, so every step is also a
 * position on the Settings → Reading font-size slider.
 */
export type ReaderTextSizeAction = 'bigger' | 'smaller' | 'reset';

export const READER_TEXT_SIZE_PERCENT_STEPS: readonly number[] = [
  80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
];

export const readerFontSizeForPercent = (percent: number, defaultFontSize: number): number =>
  Math.round((defaultFontSize * percent) / 100);

const stepSizes = (defaultFontSize: number): number[] =>
  READER_TEXT_SIZE_PERCENT_STEPS.map((percent) => readerFontSizeForPercent(percent, defaultFontSize));

export const getReaderFontSizeBounds = (defaultFontSize: number): { min: number; max: number } => {
  const sizes = stepSizes(defaultFontSize);
  return { min: sizes[0], max: sizes[sizes.length - 1] };
};

/** Next body size for an action; stays put at the ends of the range. */
export const nextReaderFontSize = (
  current: number,
  action: ReaderTextSizeAction,
  defaultFontSize: number,
): number => {
  if (action === 'reset') return defaultFontSize;
  const sizes = stepSizes(defaultFontSize);
  const { min, max } = getReaderFontSizeBounds(defaultFontSize);
  if (action === 'bigger') {
    return sizes.find((size) => size > current) ?? Math.max(current, max);
  }
  for (let index = sizes.length - 1; index >= 0; index -= 1) {
    if (sizes[index] < current) return sizes[index];
  }
  return Math.min(current, min);
};

/** Percentage shown in the size indicator; a step shows its own round value. */
export const readerTextSizePercent = (fontSize: number, defaultFontSize: number): number => {
  const stepIndex = stepSizes(defaultFontSize).indexOf(fontSize);
  if (stepIndex >= 0) return READER_TEXT_SIZE_PERCENT_STEPS[stepIndex];
  return Math.round((fontSize / defaultFontSize) * 100);
};

/** Body size actually on screen: custom layout off means the default size. */
export const effectiveReaderFontSize = (
  layout: ReadingLayoutSettings,
  defaultLayout: ReadingLayoutSettings,
): number => (layout.enabled ? layout.fontSize : defaultLayout.fontSize);

/**
 * Settings patch for a new body size. With custom layout off, the size can
 * only take effect by turning it on, so the patch also carries the values
 * currently on screen (default or reader-theme spacing) to keep everything
 * else looking the same.
 */
export const buildReaderTextSizePatch = (
  layout: ReadingLayoutSettings,
  fontSize: number,
  onScreenLayout: ReadingLayoutSettings,
): Partial<ReadingLayoutSettings> => {
  if (layout.enabled) return { fontSize };
  return { ...onScreenLayout, enabled: true, fontSize };
};
