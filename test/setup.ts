import "@testing-library/jest-dom/vitest";
import { TextDecoder, TextEncoder } from "node:util";
import { webcrypto } from "node:crypto";
import { ReadableStream } from "node:stream/web";
import { beforeEach, vi } from "vitest";

if (typeof globalThis.ReadableStream === "undefined") {
  (globalThis as unknown as Record<string, unknown>).ReadableStream = ReadableStream;
}

const localStorageStore = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => (localStorageStore.has(key) ? localStorageStore.get(key)! : null),
  setItem: (key: string, value: string) => {
    localStorageStore.set(key, String(value));
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key);
  },
  clear: () => {
    localStorageStore.clear();
  },
  key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
  get length() {
    return localStorageStore.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(() => {
  localStorageStore.clear();
});

Object.defineProperty(globalThis, "TextEncoder", {
  value: TextEncoder,
  configurable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
  value: TextDecoder,
  configurable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if (typeof performance !== "undefined") {
  if (!performance.mark) {
    (performance as unknown as Record<string, unknown>).mark = vi.fn();
  }
  if (!performance.measure) {
    (performance as unknown as Record<string, unknown>).measure = vi.fn();
  }
}

globalThis.ResizeObserver = class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: ResizeObserverCallback) {}
} as unknown as typeof ResizeObserver;

vi.mock("@/services/feeds/opmlWorkflowService", () => ({
  opmlWorkflowService: {
    attachFaviconTaskListener: vi.fn(),
    detachFaviconTaskListener: vi.fn(),
    scheduleMissingFaviconsAfterStationSelection: vi.fn(),
    prioritizeMissingFaviconsForFeeds: vi.fn(),
    importFromOpmlText: vi.fn(),
  },
}));

vi.mock("howler", () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    unload: vi.fn(),
    seek: vi.fn(),
    duration: vi.fn().mockReturnValue(0),
    playing: vi.fn().mockReturnValue(false),
    mute: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  })),
}));
