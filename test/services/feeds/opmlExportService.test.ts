import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { opmlExportService } from "@/services/feeds/opmlExportService";
import { feedsManager } from "@/services/feeds/feedsManager";
import { tagsManager } from "@/services/tags/tagsManager";

vi.mock("@/services/feeds/feedsManager", () => ({
  feedsManager: {
    getAllFeeds: vi.fn(),
  },
}));

vi.mock("@/services/tags/tagsManager", () => ({
  tagsManager: {
    getAllTags: vi.fn(),
  },
}));

describe("opmlExportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports stations and feeds in manual sort order instead of alphabetically", async () => {
    (feedsManager.getAllFeeds as Mock).mockResolvedValue([
      { id: "feed-1", title: "Zebra Feed", url: "https://example.com/z.xml", tags: [], sortOrder: 1 },
      { id: "feed-2", title: "Alpha Feed", url: "https://example.com/a.xml", tags: [], sortOrder: 0 },
      { id: "feed-3", title: "Solo Feed", url: "https://example.com/solo.xml", tags: [], sortOrder: 0 },
    ]);

    (tagsManager.getAllTags as Mock).mockResolvedValue([
      { name: "Zebra", emoji: "🦓", feedIds: ["feed-1", "feed-2"], createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 0 },
      { name: "Apple", feedIds: ["feed-2"], createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 1 },
    ]);

    const opmlText = await opmlExportService.buildOpmlText();
    const xmlDoc = new DOMParser().parseFromString(opmlText, "text/xml");
    const body = xmlDoc.querySelector("opml > body");
    const topLevelOutlines = Array.from(body!.children).filter((node) => node.tagName.toLowerCase() === "outline");

    expect(topLevelOutlines[0]?.getAttribute("kijiStationName")).toBe("Zebra");
    expect(topLevelOutlines[1]?.getAttribute("kijiStationName")).toBe("Apple");
    expect(topLevelOutlines[2]?.getAttribute("xmlUrl")).toBe("https://example.com/solo.xml");

    const zebraStation = topLevelOutlines[0]!;
    const zebraFeeds = Array.from(zebraStation.children).filter((node) => node.tagName.toLowerCase() === "outline");
    expect(zebraFeeds[0]?.getAttribute("xmlUrl")).toBe("https://example.com/a.xml");
    expect(zebraFeeds[1]?.getAttribute("xmlUrl")).toBe("https://example.com/z.xml");
  });

  it("exports OPML with two-level station structure and duplicates multi-station feeds", async () => {
    (feedsManager.getAllFeeds as Mock).mockResolvedValue([
      { id: "feed-1", title: "Alpha Feed", url: "https://example.com/a.xml", tags: [], emoji: "🛰️" },
      { id: "feed-2", title: "Beta & <Feed>", url: "https://example.com/b.xml", tags: [] },
      { id: "feed-3", title: "Gamma", url: "https://example.com/c.xml", tags: [] },
    ]);

    (tagsManager.getAllTags as Mock).mockResolvedValue([
      { name: "Tech", emoji: "📟", feedIds: ["feed-1", "feed-2"], createdAt: "2026-01-01T00:00:00.000Z" },
      { name: "Daily", feedIds: ["feed-2"], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const opmlText = await opmlExportService.buildOpmlText();
    const xmlDoc = new DOMParser().parseFromString(opmlText, "text/xml");

    expect(xmlDoc.querySelector("parsererror")).toBeNull();
    expect(xmlDoc.querySelector("opml > head > title")?.textContent).toBe("KiJi Feeds");

    const body = xmlDoc.querySelector("opml > body");
    expect(body).not.toBeNull();

    const topLevelOutlines = Array.from(body!.children).filter((node) => node.tagName.toLowerCase() === "outline");
    const stationOutlines = topLevelOutlines.filter((node) => node.getAttribute("kijiStationName"));
    expect(stationOutlines.length).toBe(2);

    const techStation = stationOutlines.find((node) => node.getAttribute("kijiStationName") === "Tech") ?? null;
    expect(techStation).not.toBeNull();
    expect(techStation?.getAttribute("text")).toBe("Tech");
    expect(techStation?.getAttribute("kijiEmoji")).toBe("📟");

    const betaOutlines = body!.querySelectorAll('outline[xmlUrl="https://example.com/b.xml"]');
    expect(betaOutlines.length).toBe(2);

    const alphaOutline = body!.querySelector('outline[xmlUrl="https://example.com/a.xml"]');
    expect(alphaOutline).not.toBeNull();
    expect(alphaOutline?.getAttribute("text")).toBe("Alpha Feed");
    expect(alphaOutline?.getAttribute("kijiEmoji")).toBe("🛰️");

    const unstationedGamma =
      topLevelOutlines.find((node) => node.getAttribute("xmlUrl") === "https://example.com/c.xml") ?? null;
    expect(unstationedGamma).not.toBeNull();
  });

  it("escapes XML attributes in feed labels and urls", async () => {
    (feedsManager.getAllFeeds as Mock).mockResolvedValue([
      { id: "feed-1", title: 'A "quote" & <tag>', url: "https://example.com/feed?x=1&y=2", tags: [] },
    ]);
    (tagsManager.getAllTags as Mock).mockResolvedValue([]);

    const opmlText = await opmlExportService.buildOpmlText();

    expect(opmlText).toContain("&quot;quote&quot;");
    expect(opmlText).toContain("&amp;");
    expect(opmlText).toContain("&lt;tag&gt;");

    const xmlDoc = new DOMParser().parseFromString(opmlText, "text/xml");
    const feedOutline = xmlDoc.querySelector("opml > body > outline");
    expect(feedOutline?.getAttribute("xmlUrl")).toBe("https://example.com/feed?x=1&y=2");
    expect(feedOutline?.getAttribute("text")).toBe('A "quote" & <tag>');
  });
});
