/**
 * StaticResourceService
 *
 * Handles logic for processing static resources, particularly image URLs.
 * Some image sources (like Longbridge/pbkrs) use x-oss-process query parameters
 * for resizing and styling. This service ensures we use the correct URLs
 * and avoid 400 errors caused by incorrect parameter appending.
 */

export class StaticResourceService {
  /**
   * Process an image element's attributes to ensure it uses the best available source.
   * If an 'original-src' attribute exists and the 'src' is known to be problematic
   * (e.g., contains x-oss-process), it prefers the original source.
   */
  static processImageAttributes(img: HTMLImageElement): void {
    const src = img.getAttribute('src');
    const originalSrc = img.getAttribute('original-src');

    if (!src) return;

    // Strategy 1: If original-src exists, it's often the clean version of a proxied/processed image.
    // If the current src contains x-oss-process, it might be a lower quality or broken version.
    if (originalSrc && src.includes('x-oss-process')) {
      img.setAttribute('src', originalSrc);
      // Keep the old src in a data attribute just in case
      img.setAttribute('data-processed-src', src);
      return;
    }

    // Strategy 2: Clean up URLs that might have been double-proxied or have broken parameters.
    const cleanedSrc = this.cleanImageUrl(src);
    if (cleanedSrc !== src) {
      img.setAttribute('src', cleanedSrc);
      img.setAttribute('data-original-src-before-clean', src);
    }
  }

  /**
   * Cleans an image URL by removing problematic query parameters or fixing proxy structures.
   */
  static cleanImageUrl(url: string): string {
    if (!url) return url;

    try {
      // Handle the case where x-oss-process is appended to an already proxied URL
      // causing a 400 error.
      if (url.includes('imageproxy.pbkrs.com') && url.includes('x-oss-process')) {
        const urlObj = new URL(url);
        if (urlObj.searchParams.has('x-oss-process')) {
          urlObj.searchParams.delete('x-oss-process');
          return urlObj.toString();
        }
      }

      // If it's a known OSS-style URL with a style/ parameter that's failing, 
      // we might want to strip it to get the original.
      if (url.includes('pub.pbkrs.com') && url.includes('x-oss-process=style/')) {
        const urlObj = new URL(url);
        urlObj.searchParams.delete('x-oss-process');
        return urlObj.toString();
      }

    } catch (e) {
      // If URL parsing fails, return original
      return url;
    }

    return url;
  }
}

export const staticResourceService = StaticResourceService;
