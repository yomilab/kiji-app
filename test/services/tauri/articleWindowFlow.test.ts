import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord } from "@/lib/tauriClient/contracts";
import { articleToRecord, recordToArticle } from "@/stores/articleStore";
import type { Article } from "@/types/article";

const emitMock = vi.fn(async () => {});
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emitMock(...args),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const sampleArticle: Article = {
  hash: "article-hash-1",
  title: "First article",
  description: "Summary",
  content: "<p>Body</p>",
  link: "https://example.com/first",
  fetchedDate: "2026-06-06T10:00:00.000Z",
  feedId: "feed-1",
  feedUrl: "https://example.com/feed.xml",
  read: false,
  starred: false,
  saved: false,
  enclosures: [{ url: "https://example.com/audio.mp3", type: "audio/mpeg" }],
};

const secondArticle: Article = {
  ...sampleArticle,
  hash: "article-hash-2",
  title: "Second article",
  link: "https://example.com/second",
};

describe("article window open/reopen flow", () => {
  let storedPayload: ArticleRecord | null = null;

  beforeEach(() => {
    storedPayload = null;
    emitMock.mockClear();
    invokeMock.mockReset();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;

    invokeMock.mockImplementation(async (command: string, args?: { article?: ArticleRecord }) => {
      if (command === "shell_article_window_open") {
        storedPayload = args?.article ?? null;
        return;
      }

      if (command === "shell_article_window_get_data") {
        if (!storedPayload) {
          throw new Error("No article payload was provided for the Tauri article window.");
        }
        return storedPayload;
      }

      if (command === "diagnostics_log_write_entry") {
        return;
      }

      throw new Error(`Unexpected invoke command: ${command}`);
    });
  });

  it("stores article records on open and round-trips them through getArticleWindowData", async () => {
    const { installElectronApiCompat } = await import("@/services/tauri/electronApiCompat");
    installElectronApiCompat();

    await window.electronAPI.openArticleWindow({ article: sampleArticle });
    const loaded = await window.electronAPI.getArticleWindowData();

    expect(invokeMock).toHaveBeenCalledWith(
      "shell_article_window_open",
      { article: articleToRecord(sampleArticle) },
    );
    expect(emitMock).toHaveBeenCalledWith("article-window:open");
    expect(loaded.hash).toBe(sampleArticle.hash);
    expect(loaded.title).toBe(sampleArticle.title);
    expect(loaded.enclosures).toEqual(sampleArticle.enclosures);
  });

  it("replaces the stored payload when reopening with a different article", async () => {
    const { installElectronApiCompat } = await import("@/services/tauri/electronApiCompat");
    installElectronApiCompat();

    await window.electronAPI.openArticleWindow({ article: sampleArticle });
    await window.electronAPI.openArticleWindow({ article: secondArticle });

    const loaded = await window.electronAPI.getArticleWindowData();
    const expected = recordToArticle(articleToRecord(secondArticle));

    expect(loaded.hash).toBe(expected.hash);
    expect(loaded.title).toBe(expected.title);
    expect(storedPayload).toEqual(articleToRecord(secondArticle));
    expect(emitMock).toHaveBeenCalledTimes(2);
  });
});
