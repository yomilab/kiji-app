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

export function getOptionalField(item: unknown, key: string): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  return getTextValue((item as Record<string, unknown>)[key]);
}
