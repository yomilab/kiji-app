import { describe, expect, it, vi } from "vitest";

import { mapUserSettingsToNativePatch } from "@/services/settings/nativeSettingsSync";
import { DEFAULT_SETTINGS } from "@/services/settings";

describe("nativeSettingsSync", () => {
  it("maps savedArticlesSyncFolder into the native settings patch", () => {
    const patch = mapUserSettingsToNativePatch({
      ...DEFAULT_SETTINGS,
      savedArticlesSyncFolder: "/Users/m/Sync/Notes/daily/kiji",
    });

    expect(patch.savedArticlesSyncFolder).toBe("/Users/m/Sync/Notes/daily/kiji");
  });

  it("maps null savedArticlesSyncFolder when sync is disabled", () => {
    const patch = mapUserSettingsToNativePatch({
      ...DEFAULT_SETTINGS,
      savedArticlesSyncFolder: null,
    });

    expect(patch.savedArticlesSyncFolder).toBeNull();
  });
});
