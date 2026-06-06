import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { savedArticlesSyncEventBus } from "@/services/saved/sync/savedArticlesSyncEventBus";
import { savedArticlesSyncBridge } from "@/services/saved/sync/savedArticlesSyncBridge";

describe("savedArticlesSyncBridge", () => {
  const queueMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    queueMock.mockReset();
    queueMock.mockResolvedValue(undefined);
    savedArticlesSyncBridge.stop();
    window.electronAPI = {
      queueSavedArticlesFolderSync: queueMock,
    } as unknown as typeof window.electronAPI;
    vi.useFakeTimers();
  });

  afterEach(() => {
    savedArticlesSyncBridge.stop();
    vi.useRealTimers();
  });

  it("forwards saved lifecycle events to the native folder sync queue", async () => {
    savedArticlesSyncBridge.start();

    savedArticlesSyncEventBus.publish({
      type: "saved",
      savedArticleId: "saved-1",
      title: "Example title",
    });

    await vi.runAllTimersAsync();

    expect(queueMock).toHaveBeenCalledWith({
      type: "saved",
      savedArticleId: "saved-1",
      title: "Example title",
    });
  });

  it("does not start when queueSavedArticlesFolderSync is unavailable", () => {
    window.electronAPI = {} as typeof window.electronAPI;
    savedArticlesSyncBridge.start();

    savedArticlesSyncEventBus.publish({
      type: "saved",
      savedArticleId: "saved-2",
      title: "Ignored",
    });

    expect(queueMock).not.toHaveBeenCalled();
  });
});
