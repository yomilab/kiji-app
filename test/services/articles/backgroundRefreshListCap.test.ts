import { describe, expect, it } from "vitest";
import {
  backgroundRefreshQueryCount,
  capBackgroundRefreshList,
} from "@/services/articles/backgroundRefreshListCap";
import type { Article } from "@/types/article";

const article = (hash: string): Article => ({
  hash,
  title: hash,
  description: "",
  content: "",
  fetchedDate: "2026-10-19T00:00:00.000Z",
  feedId: "f",
  feedUrl: "https://example.com/feed",
  read: false,
  starred: false,
  saved: false,
});
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => article(`${prefix}${i}`));

describe("background refresh list cap", () => {
  it("keeps visible behavior: fresh rows merge ahead of everything loaded", () => {
    const loaded = range("old", 300);
    const fresh = range("new", 5);
    const result = capBackgroundRefreshList(fresh, loaded, { hidden: false, atTop: true, previousLength: 300, pageSize: 100 });
    expect(result.list).toHaveLength(305);
    expect(result.list[0].hash).toBe("new0");
    expect(backgroundRefreshQueryCount({ hidden: false, atTop: true, previousLength: 300, pageSize: 100 })).toBe(300);
  });

  it("hidden at the top keeps only the first page, however many cycles run", () => {
    let loaded = range("old", 300);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const input = { hidden: true, atTop: true, previousLength: loaded.length, pageSize: 100 };
      expect(backgroundRefreshQueryCount(input)).toBe(100);
      const result = capBackgroundRefreshList(range(`c${cycle}-`, 10), loaded, input);
      expect(result.list.length).toBeLessThanOrEqual(100);
      expect(result.pageWasFull).toBe(true);
      loaded = result.list;
    }
    expect(loaded[0].hash).toBe("c49-0");
  });

  it("hidden while scrolled down never grows past the current length", () => {
    const loaded = range("old", 250);
    const result = capBackgroundRefreshList(range("new", 20), loaded, { hidden: true, atTop: false, previousLength: 250, pageSize: 100 });
    expect(result.list).toHaveLength(250);
    expect(result.list[0].hash).toBe("new0");
    expect(result.list[result.list.length - 1].hash).toBe("old229");
    expect(result.pageWasFull).toBe(true);
  });

  it("short lists are left alone", () => {
    const result = capBackgroundRefreshList(range("new", 3), range("old", 10), { hidden: true, atTop: true, previousLength: 10, pageSize: 100 });
    expect(result.list).toHaveLength(13);
    expect(result.pageWasFull).toBe(false);
  });
});
