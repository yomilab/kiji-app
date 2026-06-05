export interface FontFamilySettings {
  uiFont: string;
  articleTitleFont: string;
  articleContentFont: string;
  articleNonAsciiFont: string;
}

export interface ReadingLayoutSettings {
  enabled?: boolean;
  fontSize: number;
  fontWeight: number;
  lineSpacing: number;
  characterSpacing: number;
  wordSpacing: number;
  maxWidth: number;
  justifyText: boolean;
}

const DEFAULT_READING_LAYOUT: ReadingLayoutSettings = {
  enabled: true,
  fontSize: 18,
  fontWeight: 500,
  lineSpacing: 1.8,
  characterSpacing: 0,
  wordSpacing: 0,
  maxWidth: 720,
  justifyText: false,
};

const applyCssVar = (name: string, value: string): void => {
  document.documentElement.style.setProperty(name, value);
};

const resolveReadingLayout = (readingLayout: ReadingLayoutSettings): ReadingLayoutSettings =>
  readingLayout.enabled === false ? DEFAULT_READING_LAYOUT : readingLayout;

export const applyFontFamiliesToRoot = (fontFamilies: FontFamilySettings): void => {
  applyCssVar("--font-family-ui", fontFamilies.uiFont);
  applyCssVar("--font-family-article-title", fontFamilies.articleTitleFont);
  applyCssVar("--font-family-article-content", fontFamilies.articleContentFont);
  applyCssVar("--font-family-article-no-ascii", fontFamilies.articleNonAsciiFont);
};

export const applyReadingLayoutToRoot = (readingLayout: ReadingLayoutSettings): void => {
  const effectiveLayout = resolveReadingLayout(readingLayout);
  applyCssVar("--article-content-font-size", `${effectiveLayout.fontSize}px`);
  applyCssVar("--article-content-font-weight", String(effectiveLayout.fontWeight));
  applyCssVar("--article-content-line-height", String(effectiveLayout.lineSpacing));
  applyCssVar("--article-content-letter-spacing", `${effectiveLayout.characterSpacing / 100}em`);
  applyCssVar("--article-content-word-spacing", `${effectiveLayout.wordSpacing / 100}em`);
  applyCssVar("--max-article-content-width", `${effectiveLayout.maxWidth}px`);
  applyCssVar("--article-content-text-align", effectiveLayout.justifyText ? "justify" : "left");
};
