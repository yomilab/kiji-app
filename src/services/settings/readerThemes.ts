/**
 * Reader themes: book-reader palettes and type pairings, each with a light
 * and a dark version.
 *
 * Colors live in `src/styles/reader-themes.css` as `--rt-*` tokens on
 * `[data-reader-theme="<id>"][data-reader-scheme="light|dark"]`. This registry
 * carries what CSS cannot decide: the article fonts and the reading weight /
 * line height, which ThemeProvider sets inline on the root (inline outranks
 * any stylesheet). Fonts and rhythm are shared by both versions of a theme.
 *
 * Users pick one theme (`readerTheme`); the existing Light/Dark/Auto setting
 * picks which version renders.
 */

import { FontStack } from './fontFamilies';
import type { FontFamilySettings, ReadingLayoutSettings } from './types';

export type ReaderThemeScheme = 'light' | 'dark';

export interface ReaderTheme {
  id: string;
  label: string;
  /** Where the look comes from, shown in Settings and the Storybook gallery. */
  inspiration: string;
  /** Human-readable font pairing. */
  typeface: string;
  titleFont: string;
  bodyFont: string;
  contentFontWeight: number;
  contentLineHeight: number;
}

/** `default` keeps the built-in Yomi Reader palette in both schemes. */
export const DEFAULT_READER_THEME = 'default';

export const READER_THEMES: readonly ReaderTheme[] = [
  {
    id: 'paper',
    label: 'Paper',
    inspiration: 'Apple Books Original / Paper',
    typeface: 'New York titles, Iowan Old Style body',
    titleFont: FontStack.READER_NEW_YORK,
    bodyFont: FontStack.READER_IOWAN,
    contentFontWeight: 400,
    contentLineHeight: 1.7,
  },
  {
    id: 'sepia',
    label: 'Sepia',
    inspiration: 'Kindle Sepia',
    typeface: 'Palatino throughout',
    titleFont: FontStack.READER_PALATINO,
    bodyFont: FontStack.READER_PALATINO,
    contentFontWeight: 400,
    contentLineHeight: 1.75,
  },
  {
    id: 'calm',
    label: 'Calm',
    inspiration: 'Apple Books Calm and Focus',
    typeface: 'Athelas throughout',
    titleFont: FontStack.READER_ATHELAS,
    bodyFont: FontStack.READER_ATHELAS,
    contentFontWeight: 400,
    contentLineHeight: 1.75,
  },
  {
    id: 'eye-care',
    label: 'Eye Care',
    inspiration: 'Soft green, easy on the eyes',
    typeface: 'Avenir Next + PingFang, CJK friendly',
    titleFont: FontStack.READER_AVENIR_NEXT,
    bodyFont: FontStack.READER_AVENIR_NEXT,
    contentFontWeight: 400,
    contentLineHeight: 1.85,
  },
  {
    id: 'washi',
    label: 'Washi',
    inspiration: 'Japanese paper and ink',
    typeface: 'Hiragino Mincho, CJK first',
    titleFont: FontStack.READER_MINCHO,
    bodyFont: FontStack.READER_MINCHO,
    contentFontWeight: 400,
    contentLineHeight: 1.9,
  },
  {
    id: 'parchment',
    label: 'Parchment',
    inspiration: 'Old manuscript paper',
    typeface: 'Big Caslon titles, Hoefler Text body',
    titleFont: FontStack.READER_BIG_CASLON,
    bodyFont: FontStack.READER_HOEFLER,
    contentFontWeight: 400,
    contentLineHeight: 1.75,
  },
  {
    id: 'newsprint',
    label: 'Newsprint',
    inspiration: 'Broadsheet newspapers, Instapaper',
    typeface: 'Baskerville headlines, Georgia body',
    titleFont: FontStack.READER_BASKERVILLE,
    bodyFont: FontStack.READER_GEORGIA,
    contentFontWeight: 400,
    contentLineHeight: 1.6,
  },
  {
    id: 'e-ink',
    label: 'E-Ink',
    inspiration: 'Kindle e-ink gray',
    typeface: 'Charter throughout',
    titleFont: FontStack.READER_CHARTER,
    bodyFont: FontStack.READER_CHARTER,
    contentFontWeight: 450,
    contentLineHeight: 1.65,
  },
  {
    id: 'solarized',
    label: 'Solarized',
    inspiration: 'Solarized colors, light and dark',
    typeface: 'Avenir Next titles, Charter body',
    titleFont: FontStack.READER_AVENIR_NEXT,
    bodyFont: FontStack.READER_CHARTER,
    contentFontWeight: 400,
    contentLineHeight: 1.7,
  },
  {
    id: 'quiet',
    label: 'Quiet',
    inspiration: 'Apple Books Quiet, soft gray',
    typeface: 'Charter throughout',
    titleFont: FontStack.READER_CHARTER,
    bodyFont: FontStack.READER_CHARTER,
    contentFontWeight: 400,
    contentLineHeight: 1.75,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    inspiration: 'Night blue',
    typeface: 'Seravek titles and body',
    titleFont: FontStack.READER_SERAVEK,
    bodyFont: FontStack.READER_SERAVEK,
    contentFontWeight: 400,
    contentLineHeight: 1.8,
  },
  {
    id: 'oled-night',
    label: 'OLED Night',
    inspiration: 'Kindle Black with warm amber',
    typeface: 'Iowan Old Style throughout',
    titleFont: FontStack.READER_IOWAN,
    bodyFont: FontStack.READER_IOWAN,
    contentFontWeight: 400,
    contentLineHeight: 1.75,
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    inspiration: 'Maximum contrast, wide type',
    typeface: 'Verdana, wide and legible',
    titleFont: FontStack.READER_VERDANA,
    bodyFont: FontStack.READER_VERDANA,
    contentFontWeight: 500,
    contentLineHeight: 1.7,
  },
];

export function findReaderTheme(id: string | undefined): ReaderTheme | undefined {
  return READER_THEMES.find((theme) => theme.id === id);
}

/**
 * Pre-pairing settings stored one preset per scheme. Their ids map onto the
 * paired theme of the same name; removed presets (`bold`) fall back to default.
 */
interface LegacyReaderThemeSlots {
  light?: unknown;
  dark?: unknown;
}

/** Any stored value becomes a known theme id or `default`. */
export function normalizeReaderTheme(value: unknown, legacySlots?: unknown): string {
  if (typeof value === 'string') {
    return findReaderTheme(value)?.id ?? DEFAULT_READER_THEME;
  }
  if (legacySlots && typeof legacySlots === 'object') {
    const { light, dark } = legacySlots as LegacyReaderThemeSlots;
    for (const slot of [light, dark]) {
      const theme = typeof slot === 'string' ? findReaderTheme(slot) : undefined;
      if (theme) return theme.id;
    }
  }
  return DEFAULT_READER_THEME;
}

/** The theme on screen, or undefined for the built-in palette. */
export function resolveActiveReaderTheme(readerTheme: string): ReaderTheme | undefined {
  return findReaderTheme(readerTheme);
}

/**
 * Theme fonts apply to the article title and body only while the user is on
 * the default font for that role; a font picked in Settings always wins.
 * The UI and non-ASCII fonts are never changed by a theme.
 */
export function resolveThemedFontFamilies(
  fontFamilies: FontFamilySettings,
  theme: ReaderTheme | undefined,
): FontFamilySettings {
  if (!theme) return fontFamilies;
  return {
    ...fontFamilies,
    articleTitleFont: fontFamilies.articleTitleFont === FontStack.ARTICLE_TITLE_DEFAULT
      ? theme.titleFont
      : fontFamilies.articleTitleFont,
    articleContentFont: fontFamilies.articleContentFont === FontStack.ARTICLE_CONTENT_DEFAULT
      ? theme.bodyFont
      : fontFamilies.articleContentFont,
  };
}

/**
 * Theme weight and line height apply only while custom reading layout is
 * off; a user who enabled it in Settings keeps every value they chose.
 */
export function resolveThemedReadingLayout(
  readingLayout: ReadingLayoutSettings,
  theme: ReaderTheme | undefined,
  defaultLayout: ReadingLayoutSettings,
): ReadingLayoutSettings {
  if (!theme || readingLayout.enabled) return readingLayout;
  return {
    ...defaultLayout,
    enabled: true,
    fontWeight: theme.contentFontWeight,
    lineSpacing: theme.contentLineHeight,
  };
}
