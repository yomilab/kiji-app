import { describe, expect, it } from "vitest";
import {
  dataUrlToBytes,
} from "@/services/articles/pdfInlineService";

describe("pdfInlineService", () => {
  it("decodes a PDF data URL into bytes", () => {
    const bytes = dataUrlToBytes("data:application/pdf;base64,JVBERi0xLjQK");
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
  });

  it("rejects invalid data URLs", () => {
    expect(() => dataUrlToBytes("not-a-data-url")).toThrow("Invalid data URL");
  });
});
