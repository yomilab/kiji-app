export const isDevelopment = import.meta.env.DEV;
export const isDev = isDevelopment;
export const isProduction = import.meta.env.PROD;

export function debugOnly<T>(value: T | (() => T)): T | undefined {
  if (!isDevelopment) {
    return undefined;
  }
  return typeof value === 'function' ? (value as () => T)() : value;
}

export function getRendererOrigin(): string {
  return window.location.origin;
}
