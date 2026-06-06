/**
 * Filename Sanitizer Service
 * Handles sanitizing strings for use as filenames across different OS
 */
import { textSanitizer } from './textSanitizer';

const DEFAULT_TITLE = 'Untitled';
const MAX_TITLE_LENGTH = 180;
const MAX_FILENAME_LENGTH = 180;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

class FilenameService {
  normalizeTitle(title: string): string {
    const sanitized = textSanitizer.sanitizeTitle(title || DEFAULT_TITLE);
    if (sanitized.length <= MAX_TITLE_LENGTH) {
      return sanitized;
    }

    return `${sanitized.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
  }

  /**
   * Sanitize a string for use as a filename
   * Removes reserved characters for Windows, macOS, and Linux
   */
  sanitizeFilename(name: string): string {
    const normalizedName = this.normalizeTitle(name);

    // Replace reserved characters with underscore
    // Windows: < > : " / \ | ? *
    // macOS/Linux: /
    let sanitized = normalizedName.replace(/[<>:"/\\|?*]/g, '_');

    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

    // Trim spaces and periods from end (Windows)
    sanitized = sanitized.trim().replace(/[.]+$/, '');

    if (WINDOWS_RESERVED_NAMES.has(sanitized.toUpperCase())) {
      sanitized = `${sanitized}_file`;
    }

    if (sanitized.length > MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH).trim().replace(/[.]+$/, '');
    }

    // Ensure it's not empty
    return sanitized.length > 0 ? sanitized : DEFAULT_TITLE.toLowerCase();
  }

  isSafeFilename(name: string): boolean {
    if (!name || typeof name !== 'string') {
      return false;
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed.endsWith('.')) {
      return false;
    }

    if (/[<>:"/\\|?*\x00-\x1F\x7F]/.test(trimmed)) {
      return false;
    }

    if (WINDOWS_RESERVED_NAMES.has(trimmed.toUpperCase())) {
      return false;
    }

    return trimmed.length <= MAX_FILENAME_LENGTH;
  }
}

export const filenameService = new FilenameService();
