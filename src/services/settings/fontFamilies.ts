/**
 * Font family configuration – single source of truth for font stacks and dropdown options.
 * Primary fonts are configured first; a common fallback is appended for each stack.
 */

/** Common sans-serif fallback – shared by UI and article sans-serif options */
const SANS_SERIF_FALLBACK =
  "system-ui, -apple-system, 'PingFang SC', sans-serif";

/** Shared CJK fallback chain across Chinese/Japanese/Korean font choices */
const CJK_FALLBACK =
  "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Microsoft YaHei', 'Heiti SC', 'STHeiti', 'SimHei', sans-serif";

/** Common serif fallback – shared by Georgia and Charter */
const SERIF_FALLBACK = "'Times New Roman', Times, serif";

function stack(primary: string, fallback: string = SANS_SERIF_FALLBACK): string {
  return primary ? `${primary}, ${fallback}` : fallback;
}

export const FontStack = {
  // System Fonts
  SF_PRO_DEFAULT: stack("'SF Pro', 'Avenir Next'"),
  AVENIR_NEXT: stack("'Avenir Next'"),
  GEORGIA: stack('Georgia', SERIF_FALLBACK),
  CHARTER: stack("'Charter', Georgia", SERIF_FALLBACK),
  SYSTEM_DEFAULT: SANS_SERIF_FALLBACK,
  HELVETICA_NEUE: stack("'Helvetica Neue', Helvetica, Arial", CJK_FALLBACK),
  HELVETICA: stack("Helvetica, 'Helvetica Neue'", CJK_FALLBACK),

  // CJK-focused system fonts
  CJK_SYSTEM_DEFAULT: CJK_FALLBACK,
  PINGFANG_SC: stack("'PingFang SC'", CJK_FALLBACK),
  HIRAGINO_SANS: stack("'Hiragino Sans'", CJK_FALLBACK),
  YU_GOTHIC: stack("'Yu Gothic', 'YuGothic'", CJK_FALLBACK),
  MEIRYO: stack('Meiryo', CJK_FALLBACK),
  APPLE_SD_GOTHIC_NEO: stack("'Apple SD Gothic Neo'", CJK_FALLBACK),
  MALGUN_GOTHIC: stack("'Malgun Gothic'", CJK_FALLBACK),
  MICROSOFT_YAHEI: stack("'Microsoft YaHei'", CJK_FALLBACK),

  // Self-hosted fonts
  AKTIV_GROTESK: stack("'Aktiv Grotesk'"),
  GOLOS_TEXT: stack("'Golos Text'"),
  GOOGLE_SANS: stack("'Google Sans'"),
  GOOGLE_SANS_TEXT: stack("'Google Sans'"), // Using Google Sans with regular weight for text
  ROBOTO: stack("'Roboto'"),
  OPEN_SANS: stack("'Open Sans'"),
  LATO: stack("'Lato'"),
  MONTSERRAT: stack("'Montserrat'"),
  POPPINS: stack("'Poppins'"),
  INTER: stack("'Inter'"),
  NUNITO: stack("'Nunito'"),
  RALEWAY: stack("'Raleway'"),
  PT_SANS: stack("'PT Sans'"),
  SOURCE_SANS_3: stack("'Source Sans 3'"),
  MERRIWEATHER: stack("'Merriweather'", SERIF_FALLBACK),
  PLAYFAIR_DISPLAY: stack("'Playfair Display'", SERIF_FALLBACK),

  // Default font stacks for different UI elements
  UI_DEFAULT: stack("'Google Sans'"),
  ARTICLE_TITLE_DEFAULT: stack("'Aktiv Grotesk'"),
  ARTICLE_CONTENT_DEFAULT: stack("'Aktiv Grotesk'"),
  ARTICLE_NON_ASCII_DEFAULT: CJK_FALLBACK,
  ARTICLE_CONTENT_SERIF: stack("'Iowan Old Style', 'Charter', 'Georgia'", SERIF_FALLBACK),
} as const;

export type FontStackValue = (typeof FontStack)[keyof typeof FontStack];

export interface FontOption {
  value: FontStackValue;
  label: string;
  isGoogleFont?: boolean;
}

export const COMMON_FONT_OPTIONS: FontOption[] = [
  // Self-hosted fonts
  { value: FontStack.AKTIV_GROTESK, label: 'Default Sans', isGoogleFont: false },
  { value: FontStack.ARTICLE_CONTENT_SERIF, label: 'Serif (Default Serif)', isGoogleFont: false },
  { value: FontStack.GOLOS_TEXT, label: 'Golos Text', isGoogleFont: false },
  { value: FontStack.GOOGLE_SANS, label: 'Google Sans (Default UI)', isGoogleFont: false },
  { value: FontStack.ROBOTO, label: 'Roboto', isGoogleFont: true },
  { value: FontStack.OPEN_SANS, label: 'Open Sans', isGoogleFont: true },
  { value: FontStack.LATO, label: 'Lato', isGoogleFont: true },
  { value: FontStack.MONTSERRAT, label: 'Montserrat', isGoogleFont: true },
  { value: FontStack.POPPINS, label: 'Poppins', isGoogleFont: true },
  { value: FontStack.INTER, label: 'Inter', isGoogleFont: true },
  { value: FontStack.NUNITO, label: 'Nunito', isGoogleFont: true },
  { value: FontStack.RALEWAY, label: 'Raleway', isGoogleFont: true },
  { value: FontStack.PT_SANS, label: 'PT Sans', isGoogleFont: true },
  { value: FontStack.SOURCE_SANS_3, label: 'Source Sans 3', isGoogleFont: true },
  { value: FontStack.MERRIWEATHER, label: 'Merriweather (Serif)', isGoogleFont: true },
  { value: FontStack.PLAYFAIR_DISPLAY, label: 'Playfair Display (Serif)', isGoogleFont: true },

  // System Fonts
  { value: FontStack.SF_PRO_DEFAULT, label: 'SF Pro', isGoogleFont: false },
  { value: FontStack.AVENIR_NEXT, label: 'Avenir Next', isGoogleFont: false },
  { value: FontStack.HELVETICA, label: 'Helvetica', isGoogleFont: false },
  { value: FontStack.HELVETICA_NEUE, label: 'Helvetica Neue', isGoogleFont: false },
  { value: FontStack.GEORGIA, label: 'Georgia', isGoogleFont: false },
  { value: FontStack.CHARTER, label: 'Charter', isGoogleFont: false },
  { value: FontStack.SYSTEM_DEFAULT, label: 'System Default', isGoogleFont: false },
];

export const CJK_FONT_OPTIONS: FontOption[] = [
  { value: FontStack.CJK_SYSTEM_DEFAULT, label: 'System Default', isGoogleFont: false },
  { value: FontStack.PINGFANG_SC, label: 'PingFang SC (Chinese)', isGoogleFont: false },
  { value: FontStack.MICROSOFT_YAHEI, label: 'Microsoft YaHei (Chinese)', isGoogleFont: false },
  { value: FontStack.HIRAGINO_SANS, label: 'Hiragino Sans (Japanese)', isGoogleFont: false },
  { value: FontStack.YU_GOTHIC, label: 'Yu Gothic (Japanese)', isGoogleFont: false },
  { value: FontStack.MEIRYO, label: 'Meiryo (Japanese)', isGoogleFont: false },
  { value: FontStack.APPLE_SD_GOTHIC_NEO, label: 'Apple SD Gothic Neo (Korean)', isGoogleFont: false },
  { value: FontStack.MALGUN_GOTHIC, label: 'Malgun Gothic (Korean)', isGoogleFont: false },
];
