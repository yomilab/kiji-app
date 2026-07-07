import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runSchedulerWakeE2e } from "../../scripts/e2e/scheduler-wake.mjs";

describe("Scheduler wake E2E", () => {
  it(
    "runs catch-up through the real Rust resume emit path and imports post-wake articles",
    async () => {
      const result = await runSchedulerWakeE2e();
      assertE2eNotSkipped(result);

      if (result.skipped) {
        expect(result.reason).toBeTruthy();
        return;
      }

      expect(result.cycleCount).toBeGreaterThanOrEqual(2);
      expect(result.articleCountAfterWake).toBeGreaterThanOrEqual(2);
      expect(result.initialArticleCount).toBeGreaterThanOrEqual(1);
    },
    180_000,
  );
});
