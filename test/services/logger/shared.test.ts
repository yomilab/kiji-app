import { describe, expect, it } from "vitest";
import { sanitizeForLogging, serializeError } from "@/services/logger/shared";

describe("logger shared helpers", () => {
  it("redacts sensitive content fields from log context", () => {
    expect(
      sanitizeForLogging({
        url: "https://example.com/article",
        content: "<html>secret</html>",
        authorization: "Bearer token",
        nested: {
          html: "<p>hidden</p>",
          ok: true,
        },
      }),
    ).toEqual({
      url: "https://example.com/article",
      nested: {
        ok: true,
      },
    });
  });

  it("serializes errors consistently", () => {
    const error = new Error("boom");
    expect(serializeError(error)).toMatchObject({
      name: "Error",
      message: "boom",
    });
  });
});
