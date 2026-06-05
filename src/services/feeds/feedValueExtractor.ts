export function getTextValue(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && "value" in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === "string" ? nested : undefined;
  }
  return undefined;
}
