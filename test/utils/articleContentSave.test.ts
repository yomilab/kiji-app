import { describe, expect, it } from "vitest";
import {
  getLinkOnlySavedContent,
  linkLooksLikePdf,
  shouldSaveLinkOnlyContent,
} from "@/utils/articleContentSave";

describe("articleContentSave", () => {
  describe("linkLooksLikePdf", () => {
    it("detects .pdf path extension", () => {
      expect(linkLooksLikePdf("https://example.com/files/report.pdf")).toBe(true);
      expect(linkLooksLikePdf("https://example.com/files/report.PDF?token=1")).toBe(true);
    });

    it("rejects non-pdf links", () => {
      expect(linkLooksLikePdf("https://example.com/article")).toBe(false);
      expect(linkLooksLikePdf(undefined)).toBe(false);
    });
  });

  describe("shouldSaveLinkOnlyContent", () => {
    it("returns true for pdf and unsupported resource types", () => {
      expect(shouldSaveLinkOnlyContent("pdf", "https://example.com/doc.pdf")).toBe(true);
      expect(shouldSaveLinkOnlyContent("unsupported", "https://example.com/archive.zip")).toBe(true);
    });

    it("returns true when link looks like pdf even if resource type is unknown", () => {
      expect(shouldSaveLinkOnlyContent(null, "https://example.com/doc.pdf")).toBe(true);
    });

    it("returns false for normal html articles", () => {
      expect(shouldSaveLinkOnlyContent("html", "https://example.com/article")).toBe(false);
      expect(shouldSaveLinkOnlyContent(null, "https://example.com/article")).toBe(false);
    });
  });

  describe("getLinkOnlySavedContent", () => {
    it("returns empty string so saved rows keep link only", () => {
      expect(getLinkOnlySavedContent()).toBe("");
    });
  });
});
