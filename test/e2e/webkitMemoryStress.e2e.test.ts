import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runWebKitMemoryStressE2e } from "../../scripts/e2e/webkit-memory-stress.mjs";

const WEBKIT_STRESS_TIMEOUT_MS = Number(
  process.env.KIJI_E2E_WEBKIT_STRESS_TIMEOUT_MS ?? 20 * 60 * 1000,
);

describe("WebKit memory stress E2E", () => {
  it(
    "recreates multi-GB WebContent pressure from large feed refresh cycles",
    async () => {
      const result = await runWebKitMemoryStressE2e();
      assertE2eNotSkipped(result);

      if (result.skipped) {
        expect(result.reason).toBeTruthy();
        return;
      }

      expect(["amplified", "realistic"]).toContain(result.profileName);
      expect(result.profile.name).toBe(result.profileName);
      expect(result.feedCount).toBeGreaterThanOrEqual(result.profile.feedCount);
      expect(result.totalFetchCount).toBeGreaterThan(0);
      expect(result.webKitPidCount).toBeGreaterThan(0);
      expect(result.maxWebKitMemoryMb).toBeGreaterThanOrEqual(result.profile.minWebKitMemoryMb);
      expect(result.pressureSummary?.reason).toBe("threshold-reached");
      expect(result.pressureSummary?.maxWebKitMemoryMb).toBeGreaterThanOrEqual(result.profile.minWebKitMemoryMb);
      expect(result.postImportAtMs).toBeGreaterThan(0);
      expect(result.postImportSummary?.postImportAtMs).toBe(result.postImportAtMs);
      if (result.postImportSummary?.finalPostImportCycle) {
        expect(result.postImportSummary.finalPostImportCycle.at).toBeGreaterThanOrEqual(result.postImportAtMs);
      }
      expect(result.acceptance?.minWebKitMemoryMb).toBe(result.profile.minWebKitMemoryMb);
      if (result.profileName === "realistic") {
        expect(result.uiSummary?.selectedStation).toBe("E2E WebKit Stress");
        expect(result.uiSummary?.initialArticleCount).toBeGreaterThan(0);
        expect(result.uiSummary?.loadedAfterScroll).toBeGreaterThanOrEqual(
          result.uiSummary?.initialArticleCount,
        );
        expect(result.uiSummary?.openedArticleTitle).toBeTruthy();
      }
      expect(result.artifactsDir).toBeTruthy();
    },
    WEBKIT_STRESS_TIMEOUT_MS + 30_000,
  );
});
