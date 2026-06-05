import { FeedItem } from './feedsFetcher';

// ─── Pre-compiled regex patterns ───

const PROMO_LINK_PATTERNS = [
  /wallstreetcn\.com\/shop/i,
  /mp\.weixin\.qq\.com/i,
];

const PROMO_IMAGE_PATTERNS = [
  /wpimg-wscn\.awtmt\.com/i,
  /mmbiz\.qpic\.cn/i,
];

const PROMO_TEXT_PATTERNS = [
  /以上内容来自/,
  /更多详细解读/,
  /加入.*会员/,
  /年度会员/,
  /The above content is from/i,
  /For more detailed interpretations/i,
  /please join the/i,
  /Annual Membership/i,
];

class FeedsCleaner {
  /**
   * Clean and sanitize feed item content
   */
  cleanFeedItem(item: FeedItem): FeedItem {
    return {
      ...item,
      title: this.cleanTitle(item.title),
      content: this.cleanContent(item.content),
      author: item.author ? this.cleanAuthor(item.author) : undefined,
    };
  }

  /**
   * Clean feed title
   */
  private cleanTitle(title: string): string {
    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ');
  }

  /**
   * Clean feed content - remove unwanted HTML, scripts, etc.
   */
  private cleanContent(content: string): string {
    // Create a temporary div to parse HTML
    const div = document.createElement('div');
    div.innerHTML = content;

    // Remove script tags
    const scripts = div.querySelectorAll('script');
    scripts.forEach((script) => script.remove());

    // Remove style tags
    const styles = div.querySelectorAll('style');
    styles.forEach((style) => style.remove());

    // Remove promotional/footer elements
    this.removePromotionalContent(div);

    // Remove unwanted attributes from all elements
    const allElements = div.querySelectorAll('*');
    allElements.forEach((el) => {
      // Remove event handlers and unwanted attributes (keep class for styling)
      Array.from(el.attributes).forEach((attr) => {
        if (
          attr.name.startsWith('on') ||
          attr.name === 'style'
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Get cleaned HTML
    let cleaned = div.innerHTML;

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/>\s+</g, '><');

    return cleaned.trim();
  }

  /**
   * Remove promotional/footer content from articles
   */
  private removePromotionalContent(container: HTMLElement): void {
    // Remove links pointing to promotional URLs
    const links = container.querySelectorAll('a');
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (PROMO_LINK_PATTERNS.some((pattern) => pattern.test(href))) {
        // Remove the entire parent paragraph if it contains promotional link
        const parent = link.closest('p') || link.parentElement;
        if (parent && parent !== container) {
          parent.remove();
        } else {
          link.remove();
        }
      }
    });

    // Remove promotional images
    const images = container.querySelectorAll('img');
    images.forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (PROMO_IMAGE_PATTERNS.some((pattern) => pattern.test(src))) {
        // Remove image and its link wrapper if present
        const linkParent = img.closest('a');
        if (linkParent) {
          linkParent.remove();
        } else {
          img.remove();
        }
      }
    });

    // Remove paragraphs containing promotional text
    const paragraphs = container.querySelectorAll('p');
    paragraphs.forEach((p) => {
      const text = p.textContent || '';
      if (PROMO_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
        p.remove();
      }
    });
  }

  /**
   * Clean author name
   */
  private cleanAuthor(author: string): string {
    return author
      .trim()
      .replace(/^mailto:/i, '')
      .replace(/^\(.*?\)\s*/, '') // Remove email addresses in parentheses
      .trim();
  }

  /**
   * Remove duplicate feed items based on title and link
   */
  removeDuplicates(items: FeedItem[]): FeedItem[] {
    const seen = new Set<string>();
    const unique: FeedItem[] = [];

    for (const item of items) {
      const key = `${item.title}-${item.link}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  /**
   * Filter items by date range
   */
  filterByDateRange(
    items: FeedItem[],
    startDate?: Date,
    endDate?: Date
  ): FeedItem[] {
    return items.filter((item) => {
      if (!item.publishedDate) return true;

      const itemDate = new Date(item.publishedDate);

      if (startDate && itemDate < startDate) return false;
      if (endDate && itemDate > endDate) return false;

      return true;
    });
  }

  /**
   * Sort items by date (newest first)
   */
  sortByDate(items: FeedItem[]): FeedItem[] {
    const withTimestamps = items.map((item) => ({
      item,
      time: item.publishedDate ? new Date(item.publishedDate).getTime() : 0,
    }));
    withTimestamps.sort((a, b) => b.time - a.time);
    return withTimestamps.map(({ item }) => item);
  }

  /**
   * Clean and process multiple feed items
   */
  cleanFeedItems(items: FeedItem[]): FeedItem[] {
    return this.removeDuplicates(
      items
        .map((item) => this.cleanFeedItem(item))
        .filter((item) => item.title && item.content)
    );
  }
}

export const feedsCleaner = new FeedsCleaner();

