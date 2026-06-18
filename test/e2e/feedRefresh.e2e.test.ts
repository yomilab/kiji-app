import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runFeedRefreshE2e } from "../../scripts/e2e/feed-refresh.mjs";

describe("Feed refresh E2E", () => {
  it(
    "imports phase-2 mock feed articles on the second scheduler cycle",
    async () => {
      const result = await runFeedRefreshE2e();
      assertE2eNotSkipped(result);

      if (result.skipped) {
        expect(result.reason).toBeTruthy();
        return;
      }

      expect(result.fetchCount).toBeGreaterThanOrEqual(2);
      expect(result.articleCount).toBeGreaterThanOrEqual(2);
      expect(result.cycleCount).toBeGreaterThanOrEqual(2);
    },
    180_000,
  );
});
