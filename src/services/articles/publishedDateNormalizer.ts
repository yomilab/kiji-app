export interface NormalizePublishedDateOptions {
  now?: Date;
}

export function normalizePublishedDate(
  value?: string | null,
  options: NormalizePublishedDateOptions = {},
): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }

  const now = options.now ?? new Date();
  return new Date(Math.min(date.getTime(), now.getTime())).toISOString();
}
