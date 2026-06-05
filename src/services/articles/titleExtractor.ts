/**
 * Title Extraction Result
 * Contains the extracted title and the content with the title portion removed
 */
export interface TitleExtractionResult {
  title: string;
  cleanedContent: string;
}

/**
 * TitleExtractor - Utility for extracting titles from article content
 *
 * Handles articles that lack titles by intelligently extracting them from
 * the description/content and removing the extracted portion to avoid duplication.
 */
export class TitleExtractor {
  private static readonly MAX_TITLE_LENGTH = 200;
  private static readonly MIN_TITLE_LENGTH = 3;
  private static readonly FALLBACK_WORD_COUNT = 10;
  private static readonly FALLBACK_CHAR_COUNT = 80;

  /**
   * Extracts a title from content and returns cleaned content without the title
   *
   * Strategy:
   * 1. Look for separator patterns (colon, em-dash, en-dash, pipe, dash)
   * 2. Extract title before separator, remove it from content
   * 3. If no separator, extract first N words/characters
   *
   * @param content - HTML or plain text content
   * @returns TitleExtractionResult with title and cleanedContent
   */
  static extractTitleAndCleanContent(content: string): TitleExtractionResult {
    if (!content || content.trim().length === 0) {
      return { title: '', cleanedContent: '' };
    }

    // Clean HTML tags for title extraction (but preserve original for content)
    const cleanText = this.stripHtmlTags(content).trim();

    if (cleanText.length === 0) {
      return { title: '', cleanedContent: '' };
    }

    // Try separator patterns first
    const separatorResult = this.extractBySeparator(cleanText, content);
    if (separatorResult) {
      return separatorResult;
    }

    // Fallback: extract first N words or characters
    return this.extractByWordCount(cleanText, content);
  }

  /**
   * Try to extract title using separator patterns
   * Priority: colon > em-dash > en-dash > pipe > dash with space
   */
  private static extractBySeparator(
    cleanText: string,
    originalContent: string
  ): TitleExtractionResult | null {
    const separators = [
      { pattern: /^([^:]+):\s*(.*)$/s, name: 'colon' },
      { pattern: /^([^—]+)—\s*(.*)$/s, name: 'em-dash' },
      { pattern: /^([^–]+)–\s*(.*)$/s, name: 'en-dash' },
      { pattern: /^([^|]+)\|\s*(.*)$/s, name: 'pipe' },
      { pattern: /^([^-]+)\s+-\s+(.*)$/s, name: 'dash-space' },
    ];

    for (const { pattern } of separators) {
      const match = cleanText.match(pattern);
      if (match) {
        const potentialTitle = match[1].trim();
        const remainder = match[2].trim();

        // Validate title length
        if (
          potentialTitle.length >= this.MIN_TITLE_LENGTH &&
          potentialTitle.length <= this.MAX_TITLE_LENGTH
        ) {
          // Remove title portion from original HTML content
          const cleanedContent = this.removeExtractedTitle(
            originalContent,
            potentialTitle,
            remainder
          );

          return {
            title: potentialTitle,
            cleanedContent: cleanedContent || remainder,
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract title by taking first N words or M characters
   */
  private static extractByWordCount(
    cleanText: string,
    originalContent: string
  ): TitleExtractionResult {
    const words = cleanText.split(/\s+/);

    let title = '';
    let wordCount = 0;

    // Take words until we hit word count or character limit
    for (const word of words) {
      if (wordCount >= this.FALLBACK_WORD_COUNT) break;
      if ((title + ' ' + word).length > this.FALLBACK_CHAR_COUNT) break;

      title = title ? `${title} ${word}` : word;
      wordCount++;
    }

    title = title.trim();

    // Edge case: very short content
    if (wordCount >= words.length) {
      // All content became title
      return {
        title: title || cleanText,
        cleanedContent: '',
      };
    }

    // Remove extracted words from content
    const remainingWords = words.slice(wordCount).join(' ');
    const cleanedContent = this.removeExtractedTitle(
      originalContent,
      title,
      remainingWords
    );

    return {
      title: title || cleanText.substring(0, this.FALLBACK_CHAR_COUNT),
      cleanedContent: cleanedContent || remainingWords,
    };
  }

  /**
   * Remove the extracted title portion from the original HTML content
   * Attempts to preserve HTML structure in the remaining content
   */
  private static removeExtractedTitle(
    originalContent: string,
    _extractedTitle: string,
    remainder: string
  ): string {
    // If remainder is empty, return empty
    if (!remainder || remainder.trim().length === 0) {
      return '';
    }

    // Try to find where the remainder starts in the original HTML
    const cleanOriginal = this.stripHtmlTags(originalContent);
    const remainderStart = cleanOriginal.indexOf(remainder);

    if (remainderStart > 0) {
      // Find corresponding position in original HTML
      // This is approximate - we'll look for the first few words of remainder
      const firstWords = remainder.split(/\s+/).slice(0, 3).join(' ');
      const htmlPosition = originalContent.indexOf(firstWords);

      if (htmlPosition > 0) {
        return originalContent.substring(htmlPosition).trim();
      }
    }

    // Fallback: return remainder (plain text)
    return remainder;
  }

  /**
   * Strip HTML tags from text. Decode &amp; first so double-encoded named
   * entities (e.g. "&amp;nbsp;") collapse to a single space instead of leaking.
   */
  private static stripHtmlTags(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
