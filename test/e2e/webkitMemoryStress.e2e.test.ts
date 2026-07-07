import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runWebKitMemoryStressE2e } from "../../scripts/e2e/webkit-memory-stress.mjs";

const WEBKIT_STRESS_TIMEOUT_MS = Number(
  process.env.KIJI_E2E_WEBKIT_STRESS_TIMEOUT_MS ?? 20 * 60 * 1000,
);

describe("WebKit memory stress E2E", () => {
  it(
    "validates bounded WebKit memory under native feed ingestion",
    async () => {
      const result = await runWebKitMemoryStressE2e();
      if (result.skipped) {
        expect(result.reason).toBeTruthy();
        return;
      }
      assertE2eNotSkipped(result);

      expect(["amplified", "amplified-repro", "realistic"]).toContain(result.profileName);
      expect(result.profile.name).toBe(result.profileName);
      expect(result.feedCount).toBeGreaterThanOrEqual(result.profile.feedCount);
      expect(result.totalFetchCount).toBeGreaterThan(0);
      expect(result.webKitPidCount).toBeGreaterThan(0);
      expect(result.postImportAtMs).toBeGreaterThan(0);
      expect(result.postImportSummary?.postImportAtMs).toBe(result.postImportAtMs);
      if (result.postImportSummary?.finalPostImportCycle) {
        expect(result.postImportSummary.finalPostImportCycle.at).toBeGreaterThanOrEqual(result.postImportAtMs);
      }
      expect(result.artifactsDir).toBeTruthy();

      if (result.profile.verificationMode) {
        expect(result.maxWebKitMemoryMb).toBeLessThanOrEqual(result.profile.maxWebKitMemoryMb);
        if (result.profile.maxNativeMemoryMb) {
          expect(result.maxNativeMemoryMb).toBeLessThanOrEqual(result.profile.maxNativeMemoryMb);
        }
        expect(result.attributionSummary?.postImportLargeRendererFeedNetworkCount ?? 0).toBe(0);
        expect(result.attributionSummary?.postImportFeedParseAttributionCount ?? 0).toBe(0);
        expect(result.attributionSummary?.nativeFeedRefreshCount ?? 0).toBeGreaterThan(0);
        expect(result.pressureSummary?.reason).not.toBe("threshold-reached");
      } else {
        expect(result.maxWebKitMemoryMb).toBeGreaterThanOrEqual(result.profile.minWebKitMemoryMb);
        expect(result.pressureSummary?.reason).toBe("threshold-reached");
      }

      if (result.profileName === "realistic") {
        expect(result.uiSummary?.selectedStation).toBe("E2E WebKit Stress");
        expect(result.uiSummary?.initialArticleCount).toBeGreaterThan(0);
        expect(result.uiSummary?.loadedAfterScroll).toBeGreaterThanOrEqual(
          result.uiSummary?.initialArticleCount,
        );
        expect(result.uiSummary?.openedArticleTitle).toBeTruthy();
      }
    },
    WEBKIT_STRESS_TIMEOUT_MS + 30_000,
  );
});
