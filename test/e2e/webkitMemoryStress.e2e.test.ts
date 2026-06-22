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

      expect(result.feedCount).toBeGreaterThanOrEqual(result.profile.feedCount);
      expect(result.cycleCount).toBeGreaterThanOrEqual(result.profile.targetCycles);
      expect(result.maxWebKitMemoryMb).toBeGreaterThanOrEqual(result.profile.minWebKitMemoryMb);
      expect(result.artifactsDir).toBeTruthy();
    },
    WEBKIT_STRESS_TIMEOUT_MS + 30_000,
  );
});
