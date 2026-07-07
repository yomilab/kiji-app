import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runAppBootstrapE2e } from "../../scripts/e2e/app-bootstrap.mjs";

describe("App bootstrap E2E", () => {
  it(
    "starts KiJi, mounts the main shell, and shows imported feed articles in the list",
    async () => {
      const result = await runAppBootstrapE2e();
      assertE2eNotSkipped(result);

      if (result.skipped) {
        expect(result.reason).toBeTruthy();
        return;
      }

      expect(result.articleCount).toBeGreaterThanOrEqual(1);
      expect(result.selectedFeedId).toBe("e2e-feed");
    },
    180_000,
  );
});
