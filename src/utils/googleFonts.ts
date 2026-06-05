/**
 * Google Fonts Loader
 *
 * Dynamically loads Google Fonts using the Google Fonts API.
 * Caches loaded fonts to avoid duplicate requests.
 *
 * Note: Google Sans is self-hosted in src/assets/fonts/google-sans/ and should not be loaded via API
 */

const loadedFonts = new Set<string>();

/**
 * 50-step weight ladder used across the app for consistent typography tuning.
 * Includes 100..900 in increments of 50.
 */
const GOOGLE_FONT_WEIGHT_STEPS: number[] = Array.from(
  { length: ((900 - 100) / 50) + 1 },
  (_, index) => 100 + (index * 50)
);

/**
 * List of Google Fonts that are available via Google Fonts API
 * Note: Google Sans is NOT included as it's self-hosted locally
 */
export const GOOGLE_FONTS = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Inter',
  'Nunito',
  'Raleway',
  'PT Sans',
  'Source Sans 3',
  'Merriweather',
  'Playfair Display',
] as const;

/**
 * Fonts that are self-hosted and should not be loaded from Google Fonts API
 */
const SELF_HOSTED_FONTS = ['Google Sans', 'Google Sans Text'];

export type GoogleFontName = typeof GOOGLE_FONTS[number];

/**
 * Checks if a font family string contains a Google Font
 */
export function containsGoogleFont(fontFamily: string): GoogleFontName | null {
  // Skip self-hosted fonts
  for (const selfHostedFont of SELF_HOSTED_FONTS) {
    if (fontFamily.includes(selfHostedFont)) {
      return null;
    }
  }

  for (const googleFont of GOOGLE_FONTS) {
    if (fontFamily.includes(googleFont)) {
      return googleFont;
    }
  }
  return null;
}

/**
 * Loads a Google Font dynamically by injecting a <link> tag
 * @param fontName - Name of the Google Font to load
 * @param weights - Array of font weights to load (default: 100..900 in 50-step increments)
 */
export async function loadGoogleFont(
  fontName: GoogleFontName,
  weights: number[] = GOOGLE_FONT_WEIGHT_STEPS
): Promise<void> {
  // Check if already loaded
  if (loadedFonts.has(fontName)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      // Create link element
      const link = document.createElement('link');
      link.rel = 'stylesheet';

      // Format font name for URL (replace spaces with +)
      const urlFontName = fontName.replace(/\s+/g, '+');

      // Build weights string (e.g., "400;500;600;700")
      const weightsStr = weights.join(';');

      // Construct Google Fonts URL
      // Example: https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap
      link.href = `https://fonts.googleapis.com/css2?family=${urlFontName}:wght@${weightsStr}&display=swap`;

      // Handle load success
      link.onload = () => {
        loadedFonts.add(fontName);
        console.log(`Google Font loaded: ${fontName}`);
        resolve();
      };

      // Handle load error
      link.onerror = () => {
        console.error(`Failed to load Google Font: ${fontName}`);
        reject(new Error(`Failed to load Google Font: ${fontName}`));
      };

      // Append to document head
      document.head.appendChild(link);
    } catch (error) {
      console.error(`Error loading Google Font ${fontName}:`, error);
      reject(error);
    }
  });
}

/**
 * Loads multiple Google Fonts at once
 * @param fontNames - Array of Google Font names to load
 */
export async function loadGoogleFonts(fontNames: GoogleFontName[]): Promise<void> {
  const promises = fontNames.map(fontName => loadGoogleFont(fontName));
  await Promise.all(promises);
}

/**
 * Extracts Google Font names from a font family string and loads them
 * @param fontFamily - CSS font-family string
 */
export async function loadFontsFromFamilyString(fontFamily: string): Promise<void> {
  const googleFont = containsGoogleFont(fontFamily);
  if (googleFont) {
    await loadGoogleFont(googleFont);
  }
}

/**
 * Checks if a font is already loaded
 */
export function isFontLoaded(fontName: GoogleFontName): boolean {
  return loadedFonts.has(fontName);
}

/**
 * Clears the loaded fonts cache (useful for testing)
 */
export function clearLoadedFontsCache(): void {
  loadedFonts.clear();
}
