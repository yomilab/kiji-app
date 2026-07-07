import { describe, expect, it } from "vitest";
import { assertE2eNotSkipped } from "../../scripts/e2e/e2eSupport.mjs";
import { runNavigationSwitchE2e } from "../../scripts/e2e/navigation-switch.mjs";
import { runStationSwitchIndicatorE2e } from "../../scripts/e2e/station-switch-indicator.mjs";
import { runStationSwitchPerformanceE2e } from "../../scripts/e2e/station-switch-performance.mjs";
import { runArticleDeckE2e } from "../../scripts/e2e/article-deck.mjs";
import { runReaderModeE2e } from "../../scripts/e2e/reader-mode.mjs";
import { runOpmlImportE2e } from "../../scripts/e2e/opml-import.mjs";
import { runOpmlExportE2e } from "../../scripts/e2e/opml-export.mjs";
import { runArticleListScrollE2e } from "../../scripts/e2e/article-list-scroll.mjs";
import { runFeedEditE2e } from "../../scripts/e2e/feed-edit.mjs";
import { runFeedDeleteE2e } from "../../scripts/e2e/feed-delete.mjs";
import { runPdfArticleE2e } from "../../scripts/e2e/pdf-article.mjs";

const E2E_TIMEOUT_MS = process.env.KIJI_RUN_E2E_IN_CI === "1" ? 600_000 : 180_000;

describe("User interaction E2E", () => {
  it("switches between stations and feeds", async () => {
    const result = await runNavigationSwitchE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.alphaArticleCount).toBeGreaterThanOrEqual(1);
    expect(result.betaArticleCount).toBeGreaterThanOrEqual(1);
  }, E2E_TIMEOUT_MS);

  it("keeps sidebar refresh indicator scoped to the active station", async () => {
    const result = await runStationSwitchIndicatorE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(
      Boolean(result.betaIndicatorText)
      || typeof result.betaForegroundCount === "number",
    ).toBe(true);
    expect(
      Boolean(result.alphaIndicatorText)
      || typeof result.alphaForegroundCount === "number",
    ).toBe(true);
    if (typeof result.betaForegroundCount === "number") {
      expect(result.betaForegroundCount).toBeLessThanOrEqual(6);
    }
    if (typeof result.alphaForegroundCount === "number") {
      expect(result.alphaForegroundCount).toBeLessThanOrEqual(6);
    }
  }, E2E_TIMEOUT_MS);

  it("keeps station switches within interactive performance budgets", async () => {
    const result = await runStationSwitchPerformanceE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.dailyCold.harnessInteractiveMs).toBeLessThanOrEqual(1_200);
    expect(result.dailyWarm.harnessInteractiveMs).toBeLessThanOrEqual(1_200);
  }, E2E_TIMEOUT_MS);

  it("opens and closes the article deck", async () => {
    const result = await runArticleDeckE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.title).toBeTruthy();
  }, E2E_TIMEOUT_MS);

  it("toggles reader mode on a real HTML article", async () => {
    const result = await runReaderModeE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.wordCount).toBeGreaterThan(0);
  }, E2E_TIMEOUT_MS);

  it("imports OPML via harness command", async () => {
    const result = await runOpmlImportE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.feedCount).toBeGreaterThanOrEqual(2);
    expect(result.stationCount).toBeGreaterThanOrEqual(2);
    expect(result.articleCount).toBeGreaterThanOrEqual(1);
  }, E2E_TIMEOUT_MS);

  it("exports OPML to harness directory", async () => {
    const result = await runOpmlExportE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.outlineCount).toBeGreaterThanOrEqual(2);
    expect(result.byteLength).toBeGreaterThan(0);
  }, E2E_TIMEOUT_MS);

  it("scrolls the article list and loads more rows", async () => {
    const result = await runArticleListScrollE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.loadedAfterScroll).toBeGreaterThan(result.initialLoaded);
  }, E2E_TIMEOUT_MS);

  it("renames a station in feed management", async () => {
    const result = await runFeedEditE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.stationNames).toContain("E2E Station Renamed");
  }, E2E_TIMEOUT_MS);

  it("deletes a station in feed management", async () => {
    const result = await runFeedDeleteE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.stationNames).not.toContain("E2E Station");
  }, E2E_TIMEOUT_MS);

  it("opens a PDF article and toggles reader mode", async () => {
    const result = await runPdfArticleE2e();
    assertE2eNotSkipped(result);
    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.readerMode).toBe("reader");
  }, E2E_TIMEOUT_MS);
});
