import type { FeedItem } from "../feeds/feedsFetcher";

class ArticleHasher {
  private static readonly TRACKING_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_cid",
    "utm_reader",
    "utm_social",
    "utm_social-type",
    "rb_clickid",
    "s_kwcid",
    "gclid",
    "fbclid",
    "ref",
    "source",
    "rss",
    "fb_action_ids",
    "fb_action_types",
    "fb_source",
    "fb_ref",
    "_hsenc",
    "_hsmi",
    "mc_cid",
    "mc_eid",
    "mkt_tok",
    "assetId",
    "assetType",
    "recipientId",
    "campaignId",
    "pk_campaign",
    "pk_kwd",
    "piwik_campaign",
    "piwik_kwd",
    "yclid",
  ];

  async generateHash(item: FeedItem): Promise<string> {
    return this.sha256(this.buildHashInput(item));
  }

  buildHashInput(item: FeedItem): string {
    const normalizedLink = this.normalizeLink(item.link);
    if (normalizedLink) {
      return normalizedLink;
    }

    const guid = item.guid?.trim();
    if (guid) {
      return guid;
    }

    const normalizedTitle = this.normalizeTitle(item.title);
    if (normalizedTitle) {
      return normalizedTitle;
    }

    return this.extractWords(item.content, 100).join(" ");
  }

  private async sha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  private extractWords(text: string, maxWords: number): string[] {
    return text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, maxWords);
  }

  private normalizeLink(link?: string): string | undefined {
    const trimmed = link?.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = new URL(trimmed);
      parsed.hash = "";
      ArticleHasher.TRACKING_PARAMS.forEach((param) => parsed.searchParams.delete(param));
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      }
      return parsed.toString();
    } catch {
      return trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
  }

  private normalizeTitle(title?: string): string | undefined {
    const trimmed = title?.trim();
    return trimmed ? trimmed.toLocaleLowerCase() : undefined;
  }
}

export const articleHasher = new ArticleHasher();
