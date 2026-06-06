/**
 * Text Sanitizer Service
 * Handles encoding issues, invalid UTF-8 characters, and text normalization
 * Prevents display of garbled characters like '���'
 */

class TextSanitizer {
  private removeControlCharacters(text: string): string {
    let result = '';
    for (const char of text) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) continue;

      const isAsciiControl = (codePoint >= 0x00 && codePoint <= 0x08)
        || (codePoint >= 0x0B && codePoint <= 0x0C)
        || (codePoint >= 0x0E && codePoint <= 0x1F)
        || codePoint === 0x7F;

      if (!isAsciiControl) {
        result += char;
      }
    }
    return result;
  }

  private replaceC1ControlCharacters(text: string): string {
    let result = '';
    for (const char of text) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) continue;

      const isC1Control = codePoint >= 0x80 && codePoint <= 0x9F;
      result += isC1Control ? ' ' : char;
    }
    return result;
  }

  private hasRepeatedC1Controls(text: string): boolean {
    let streak = 0;
    for (const char of text) {
      const codePoint = char.codePointAt(0);
      if (codePoint !== undefined && codePoint >= 0x80 && codePoint <= 0x9F) {
        streak += 1;
        if (streak >= 2) {
          return true;
        }
      } else {
        streak = 0;
      }
    }
    return false;
  }

  private removeZeroWidthCharacters(text: string): string {
    const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    return zeroWidthChars.reduce((acc, char) => acc.split(char).join(''), text);
  }

  /**
   * Sanitize text to remove invalid UTF-8 and encoding errors
   * Removes or replaces unreadable characters
   */
  sanitizeText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Normalize Unicode - handle composed vs decomposed characters
    let sanitized = text.normalize('NFKC');

    // Remove control characters (except common whitespace like \n, \t)
    sanitized = this.removeControlCharacters(sanitized);

    // Remove invalid UTF-8 sequences - replace with space
    // This regex matches common mojibake patterns
    sanitized = this.removeInvalidUTF8(sanitized);

    // Remove replacement characters (often used by browsers for invalid chars)
    sanitized = sanitized.replace(/\uFFFD/g, '');

    // Remove zero-width characters
    sanitized = this.removeZeroWidthCharacters(sanitized);

    // Normalize whitespace (multiple spaces to single space)
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized;
  }

  /**
   * Remove invalid UTF-8 byte sequences
   * These often appear as mojibake or garbled text
   */
  private removeInvalidUTF8(text: string): string {
    // Match and replace high-bit sequences that don't form valid UTF-8
    // Pattern: sequences of bytes that don't match valid UTF-8 encoding rules
    return text
      // Remove sequences of common mojibake patterns (3 replacement chars in a row)
      .replace(/[\uFFFD]{2,}/g, '')
      // Remove isolated high unicode that might be encoding errors
      .replace(/./gu, (char) => this.replaceC1ControlCharacters(char))
      // Clean up sequences like "??" or "???" that often appear instead of real characters
      .replace(/\?{2,}/g, '');
  }

  /**
   * Check if text contains potential encoding issues
   */
  hasEncodingIssues(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    // Check for replacement characters
    if (text.includes('\uFFFD')) {
      return true;
    }

    // Check for sequences of non-printable high-bit characters
    if (this.hasRepeatedC1Controls(text)) {
      return true;
    }

    // Check for mojibake patterns (multiple question marks)
    if (/\?{2,}/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Sanitize article title
   * Removes invalid characters while preserving readability
   */
  sanitizeTitle(title: string): string {
    let sanitized = this.sanitizeText(title);

    // Remove leading/trailing quotes or special chars
    sanitized = sanitized.replace(/^["'«»„"]/g, '').replace(/["'»…".]$/g, '');

    // Ensure title is not empty after sanitization
    return sanitized.length > 0 ? sanitized : '(Untitled)';
  }

  /**
   * Sanitize article description
   * Preserves structure while removing invalid characters
   */
  sanitizeDescription(description: string): string {
    // For descriptions, we can be more lenient with punctuation
    // Just ensure no invalid UTF-8 sequences remain
    return this.sanitizeText(description);
  }

  /**
   * Batch sanitize multiple texts
   */
  sanitizeArray(texts: string[]): string[] {
    return texts.map((text) => this.sanitizeText(text));
  }
}

export const textSanitizer = new TextSanitizer();
