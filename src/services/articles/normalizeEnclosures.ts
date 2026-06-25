import type { Enclosure } from "../../types/article";

export const DEFAULT_ENCLOSURE_MIME_TYPE = "application/octet-stream";

export function normalizeEnclosures(value: unknown): Enclosure[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const enclosures = value
    .map((entry): Enclosure | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) {
        return null;
      }

      const rawType = record.type;
      const type = typeof rawType === "string" && rawType.trim()
        ? rawType.trim()
        : DEFAULT_ENCLOSURE_MIME_TYPE;

      const enclosure: Enclosure = { url, type };
      if (typeof record.length === "number" && Number.isFinite(record.length)) {
        enclosure.length = record.length;
      }
      if (typeof record.duration === "number" && Number.isFinite(record.duration)) {
        enclosure.duration = record.duration;
      }
      return enclosure;
    })
    .filter((enclosure): enclosure is Enclosure => enclosure !== null);

  return enclosures.length > 0 ? enclosures : undefined;
}
