import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

describe("default settings", () => {
  it("uses stable baseline layout and window dimensions", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      theme: "auto",
      layout: "2-column",
      sidebarWidth: 300,
      articleListWidth: 350,
      windowSize: {
        width: 800,
        height: 600,
      },
      backgroundUpdate: "every-15m",
      contentParser: "defuddle",
      savedArticlesSyncFolder: null,
    });
  });
});
