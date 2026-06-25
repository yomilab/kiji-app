export const E2E_STATION_ALPHA = "E2E Station Alpha";
export const E2E_STATION_BETA = "E2E Station Beta";
export const E2E_STATION_MANAGE = "E2E Station";
export const E2E_STATION_DAILY = "E2E Station Daily";
export const E2E_STATION_COMPACT = "E2E Station Compact";
export const E2E_LARGE_STATION_FEED_COUNT = 30;

export function buildAtomFeed({ feedId, title, entries }) {
  const entryXml = entries
    .map(
      (entry) => `<entry>
    <title>${escapeXml(entry.title)}</title>
    <id>${escapeXml(entry.id)}</id>
    <updated>${entry.updated ?? "2026-06-18T00:00:00Z"}</updated>
    <link href="${escapeXml(entry.link)}" />
    <summary>${escapeXml(entry.summary ?? entry.title)}</summary>
  </entry>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <id>${escapeXml(feedId)}</id>
  <updated>2026-06-18T00:00:00Z</updated>
  ${entryXml}
</feed>`;
}

export function buildScrollAtomFeed(baseUrl, count = 120) {
  const entries = Array.from({ length: count }, (_, index) => ({
    id: `e2e-scroll-${index}`,
    title: `E2E scroll article ${index}`,
    link: `${baseUrl}/articles/${index}`,
    summary: `Scroll fixture article ${index}`,
  }));
  return buildAtomFeed({
    feedId: "e2e-scroll-feed",
    title: "E2E Scroll Feed",
    entries,
  });
}

export function buildReaderAtomFeed(baseUrl) {
  return buildAtomFeed({
    feedId: "e2e-reader-feed",
    title: "E2E Reader Feed",
    entries: [
      {
        id: "e2e-reader-article",
        title: "E2E reader article",
        link: `${baseUrl}/article.html`,
        summary: "Article for reader-mode E2E.",
      },
    ],
  });
}

export function buildPdfAtomFeed(baseUrl) {
  return buildAtomFeed({
    feedId: "e2e-pdf-feed",
    title: "E2E PDF Feed",
    entries: [
      {
        id: "e2e-pdf-article",
        title: "E2E PDF article",
        link: `${baseUrl}/sample.pdf`,
        summary: "PDF inline render E2E.",
      },
    ],
  });
}

export function buildDeckAtomFeed(baseUrl) {
  return buildAtomFeed({
    feedId: "e2e-deck-feed",
    title: "E2E Deck Feed",
    entries: [
      {
        id: "e2e-deck-article",
        title: "E2E deck article",
        link: `${baseUrl}/article.html`,
        summary: "Deck open/close E2E article body.",
      },
    ],
  });
}

export function buildMultiStationOpml(baseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>E2E Navigation</title></head>
<body>
  <outline text="${E2E_STATION_ALPHA}" title="${E2E_STATION_ALPHA}">
    <outline type="rss" title="E2E Alpha Feed" text="E2E Alpha Feed" xmlUrl="${baseUrl}/alpha.xml" htmlUrl="${baseUrl}/alpha.xml" />
  </outline>
  <outline text="${E2E_STATION_BETA}" title="${E2E_STATION_BETA}">
    <outline type="rss" title="E2E Beta Feed" text="E2E Beta Feed" xmlUrl="${baseUrl}/beta.xml" htmlUrl="${baseUrl}/beta.xml" />
  </outline>
</body>
</opml>`;
}

export function buildManageStationOpml(baseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>E2E Manage</title></head>
<body>
  <outline text="${E2E_STATION_MANAGE}" title="${E2E_STATION_MANAGE}">
    <outline type="rss" title="E2E Manage Feed" text="E2E Manage Feed" xmlUrl="${baseUrl}/manage.xml" htmlUrl="${baseUrl}/manage.xml" />
  </outline>
</body>
</opml>`;
}

export function buildImportOpml(baseUrl) {
  return buildMultiStationOpml(baseUrl);
}

export function buildLargeStationPerformanceOpml(baseUrl, feedCount = E2E_LARGE_STATION_FEED_COUNT) {
  const dailyFeeds = Array.from({ length: feedCount }, (_, index) => {
    const slug = `daily-${index}`;
    return `    <outline type="rss" title="E2E Daily Feed ${index}" text="E2E Daily Feed ${index}" xmlUrl="${baseUrl}/${slug}.xml" htmlUrl="${baseUrl}/${slug}.xml" />`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>E2E Large Station Performance</title></head>
<body>
  <outline text="${E2E_STATION_COMPACT}" title="${E2E_STATION_COMPACT}">
    <outline type="rss" title="E2E Compact Feed" text="E2E Compact Feed" xmlUrl="${baseUrl}/compact.xml" htmlUrl="${baseUrl}/compact.xml" />
  </outline>
  <outline text="${E2E_STATION_DAILY}" title="${E2E_STATION_DAILY}">
${dailyFeeds}
  </outline>
</body>
</opml>`;
}

export function buildAtomFeedEntryRoutes(baseUrl, slug, feedId, titlePrefix, entryCount = 1) {
  const entries = Array.from({ length: entryCount }, (_, index) => ({
    id: `${feedId}-entry-${index}`,
    title: `${titlePrefix} article ${index}`,
    link: `${baseUrl}/${slug}/articles/${index}`,
    summary: `${titlePrefix} fixture article ${index}`,
  }));

  return {
    contentType: "application/atom+xml; charset=utf-8",
    body: buildAtomFeed({
      feedId,
      title: `${titlePrefix} Feed`,
      entries,
    }),
  };
}

export const READER_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>E2E Reader Article</title></head>
<body>
  <article>
    <h1>E2E Reader Article</h1>
    <p>This is readable fixture content for KiJi reader-mode E2E harness testing.</p>
    <p>It should parse into reader mode with a non-zero word count.</p>
  </article>
</body>
</html>`;

export const MINIMAL_PDF = Buffer.from(
  `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<< /Root 1 0 R /Size 4 >>
startxref
178
%%EOF`,
  "utf8",
);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
