/**
 * Default feed icon as base64 data URL
 * Used when favicon detection fails for a feed
 */

// Simple filled star SVG fallback (24x24 viewBox)
const starIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
</svg>`;

// Convert SVG to base64 using btoa (works in browser)
const svgBase64 = btoa(starIconSvg);

export const defaultFavicon = `data:image/svg+xml;base64,${svgBase64}`;

