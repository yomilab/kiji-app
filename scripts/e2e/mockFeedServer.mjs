import http from "node:http";

const FEED_PHASE_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E Scheduler Feed</title>
  <id>e2e-feed</id>
  <updated>2026-06-18T00:00:00Z</updated>
  <entry>
    <title>E2E initial article</title>
    <id>e2e-article-initial</id>
    <updated>2026-06-18T00:00:00Z</updated>
    <link href="https://example.com/e2e/initial" />
    <summary>Initial article for scheduler e2e.</summary>
  </entry>
</feed>`;

const FEED_PHASE_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E Scheduler Feed</title>
  <id>e2e-feed</id>
  <updated>2026-06-18T01:00:00Z</updated>
  <entry>
    <title>E2E wake article</title>
    <id>e2e-article-after-wake</id>
    <updated>2026-06-18T01:00:00Z</updated>
    <link href="https://example.com/e2e/after-wake" />
    <summary>Inserted after simulated system resume.</summary>
  </entry>
  <entry>
    <title>E2E initial article</title>
    <id>e2e-article-initial</id>
    <updated>2026-06-18T00:00:00Z</updated>
    <link href="https://example.com/e2e/initial" />
    <summary>Initial article for scheduler e2e.</summary>
  </entry>
</feed>`;

export function createMockFeedServer() {
  let fetchCount = 0;

  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/feed.xml")) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    fetchCount += 1;
    const body = fetchCount >= 2 ? FEED_PHASE_TWO : FEED_PHASE_ONE;
    response.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve mock feed server port");
      }
      return {
        feedUrl: `http://127.0.0.1:${address.port}/feed.xml`,
        fetchCount: () => fetchCount,
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

