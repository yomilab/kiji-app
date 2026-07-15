import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/services/feeds/opmlWorkflowService");

const boostMany = vi.hoisted(() => vi.fn());
const runTask = vi.hoisted(() => vi.fn());
const addTask = vi.hoisted(() => vi.fn());
const clearTasks = vi.hoisted(() => vi.fn());
const importEntries = vi.hoisted(() => vi.fn());
const showIndicator = vi.hoisted(() => vi.fn());
const clearIndicator = vi.hoisted(() => vi.fn());

vi.mock("@/services/scheduler/feedSchedulerService", () => ({
  feedScheduler: {
    boostMany,
  },
}));

vi.mock("@/services/tasks/helperTaskClient", () => ({
  helperTaskClient: {
    clearTasks,
    runTask,
    addTask,
    onTaskResult: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@/services/feeds/opmlImportService", () => ({
  opmlImportService: {
    importEntries,
  },
}));

vi.mock("@/services/feeds/feedsManager", () => ({
  feedsManager: {
    getAllFeeds: vi.fn().mockResolvedValue([]),
    applyFaviconResult: vi.fn(),
  },
}));

vi.mock("@/services/ui/sidebarIndicatorService", () => ({
  sidebarIndicatorService: {
    show: showIndicator,
    clear: clearIndicator,
  },
}));

import { opmlWorkflowService } from "@/services/feeds/opmlWorkflowService";

describe("opmlWorkflowService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTasks.mockResolvedValue(undefined);
    runTask.mockResolvedValue({
      entries: [
        { title: "Feed A", url: "https://example.com/a.xml" },
        { title: "Feed B", url: "https://example.com/b.xml" },
      ],
    });
    addTask.mockImplementation(async () => ({ taskId: `task-${Math.random()}` }));
    importEntries.mockResolvedValue({
      importedFeeds: [
        { id: "feed-a", url: "https://example.com/a.xml" },
        { id: "feed-b", url: "https://example.com/b.xml" },
      ],
      summary: { total: 2, imported: 2, skippedDuplicate: 0, invalid: 0, failed: 0 },
      navigationTarget: { type: "station", stationName: "Imported" },
    });
    opmlWorkflowService.attachFaviconTaskListener();
  });

  it("schedules scoped article refresh before favicon backfill", async () => {
    await opmlWorkflowService.importFromOpmlText("<opml></opml>");

    expect(boostMany).toHaveBeenCalledWith(["feed-a", "feed-b"]);
    const faviconIndicatorCall = showIndicator.mock.calls.find(
      ([text]) => typeof text === "string" && /fetching/i.test(text) && /favicon/i.test(text),
    );
    expect(faviconIndicatorCall).toBeDefined();
    expect(boostMany.mock.invocationCallOrder[0])
      .toBeLessThan(showIndicator.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER);
  });

  it("parses OPML via helper task and hands entries to import service", async () => {
    await opmlWorkflowService.importFromOpmlText("<opml><body></body></opml>", {
      fileName: "import.opml",
    });

    expect(runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "opml-parse",
        payload: expect.objectContaining({
          opmlText: "<opml><body></body></opml>",
          fileName: "import.opml",
        }),
      }),
    );
    expect(importEntries).toHaveBeenCalled();
  });

  it("shows parse failure text when OPML parse task fails", async () => {
    runTask.mockRejectedValueOnce(new Error("invalid opml"));

    await expect(opmlWorkflowService.importFromOpmlText("<bad>")).rejects.toThrow("invalid opml");

    expect(showIndicator).toHaveBeenCalledWith("Parse OPML failed", { durationMs: 6000 });
  });

  it("shows import failure text when entry import fails", async () => {
    importEntries.mockRejectedValueOnce(new Error("db failed"));

    await expect(opmlWorkflowService.importFromOpmlText("<opml></opml>")).rejects.toThrow("db failed");

    expect(showIndicator).toHaveBeenCalledWith("Import feeds failed", { durationMs: 6000 });
  });
});
