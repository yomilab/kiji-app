import { logger } from '@/services/logger';
import {
  getActiveInteractionPerformanceRecords,
  roundPerformanceValue,
  type MainProcessPerfSnapshot,
} from '@/services/performance/interactionPerformance';

export type RendererFreezeSeverity = 'stutter' | 'freeze' | 'beachball' | 'severe';
export type RendererInteractionEventType = 'pointerdown' | 'click' | 'keydown' | 'wheel' | 'input' | 'drop' | 'contextmenu';

interface RendererHeapSnapshot {
  usedJsHeapMb: number;
  totalJsHeapMb: number;
  jsHeapLimitMb: number;
}

export interface SemanticTargetSegment {
  tagName: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  data: Record<string, string>;
}

export interface RendererInteractionRecord {
  id: number;
  eventType: RendererInteractionEventType;
  timestamp: string;
  monotonicTimeMs: number;
  targetPath: SemanticTargetSegment[];
  key?: string;
  code?: string;
  repeat?: boolean;
  modifiers?: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  };
  button?: number;
  pointerType?: string;
  deltaX?: number;
  deltaY?: number;
  inputValueLength?: number;
  dropFileCount?: number;
}

const RENDERER_FREEZE_HEARTBEAT_INTERVAL_MS = 250;
const RECENT_INTERACTION_LIMIT = 30;
const SUSPECTED_INTERACTION_LOOKBACK_MS = 1_000;
const SUSPECTED_INTERACTION_LOOKAHEAD_MS = 200;
const RECENT_INTERACTION_FALLBACK_WINDOW_MS = 4_000;

const RENDERER_FREEZE_THRESHOLDS_MS = {
  stutter: 500,
  freeze: 1_000,
  beachball: 2_000,
  severe: 5_000,
} as const;

const INTERACTION_EVENT_TYPES: RendererInteractionEventType[] = [
  'pointerdown',
  'click',
  'keydown',
  'wheel',
  'input',
  'drop',
  'contextmenu',
];

const SEMANTIC_DATA_KEYS = [
  'section',
  'component',
  'action',
  'entityId',
  'smartViewId',
  'stationName',
] as const;
const SAFE_KEY_NAMES = new Set([
  'Alt',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Control',
  'Delete',
  'End',
  'Enter',
  'Escape',
  'Home',
  'Meta',
  'PageDown',
  'PageUp',
  'Shift',
  'Tab',
]);

const PERFORMANCE_WITH_MEMORY = performance as Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

let installed = false;
let heartbeatTimerId: number | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let nextInteractionId = 1;
let lastHeartbeatAtMs = performance.now();
let reportingFreeze = false;
let windowRole = 'main';
const recentInteractions: RendererInteractionRecord[] = [];

const getRendererHeapSnapshot = (): RendererHeapSnapshot | null => {
  const memory = PERFORMANCE_WITH_MEMORY.memory;
  if (!memory) {
    return null;
  }

  return {
    usedJsHeapMb: roundPerformanceValue(memory.usedJSHeapSize / 1024 / 1024),
    totalJsHeapMb: roundPerformanceValue(memory.totalJSHeapSize / 1024 / 1024),
    jsHeapLimitMb: roundPerformanceValue(memory.jsHeapSizeLimit / 1024 / 1024),
  };
};

const requestMainProcessSnapshot = async (): Promise<MainProcessPerfSnapshot | null> => {
  if (!window.electronAPI?.perfSnapshot) {
    return null;
  }

  try {
    return await window.electronAPI.perfSnapshot();
  } catch (error) {
    logger.warn('InteractionFreezeWatchdog', 'Failed to capture main-process snapshot for freeze report', {
      event: 'interaction-freeze-snapshot-failed',
      specialInteractionLog: true,
      requiresDebugging: true,
      error,
    });
    return null;
  }
};

export const getRendererFreezeSeverity = (stallDurationMs: number): RendererFreezeSeverity | null => {
  if (stallDurationMs >= RENDERER_FREEZE_THRESHOLDS_MS.severe) return 'severe';
  if (stallDurationMs >= RENDERER_FREEZE_THRESHOLDS_MS.beachball) return 'beachball';
  if (stallDurationMs >= RENDERER_FREEZE_THRESHOLDS_MS.freeze) return 'freeze';
  if (stallDurationMs >= RENDERER_FREEZE_THRESHOLDS_MS.stutter) return 'stutter';
  return null;
};

const getElementFromTarget = (target: EventTarget | null): Element | null => {
  if (!target) {
    return null;
  }

  if (target instanceof Element) {
    return target;
  }

  if (typeof Node !== 'undefined' && target instanceof Node) {
    return target.parentElement;
  }

  return null;
};

const getSemanticDataset = (element: Element): Record<string, string> => {
  const data: Record<string, string> = {};
  for (const key of SEMANTIC_DATA_KEYS) {
    const value = (element as HTMLElement).dataset?.[key];
    if (value) {
      data[key] = value;
    }
  }
  return data;
};

const shouldIncludeTargetSegment = (element: Element, data: Record<string, string>, depth: number): boolean => {
  if (Object.keys(data).length > 0 || depth === 0) {
    return true;
  }

  return ['A', 'BUTTON', 'INPUT', 'LI', 'SELECT', 'TEXTAREA'].includes(element.tagName)
    || element.hasAttribute('role')
    || element.hasAttribute('aria-label');
};

export const buildSemanticTargetPath = (target: EventTarget | null, maxDepth = 8): SemanticTargetSegment[] => {
  const path: SemanticTargetSegment[] = [];
  let element = getElementFromTarget(target);
  let depth = 0;

  while (element && depth < maxDepth) {
    const data = getSemanticDataset(element);
    if (shouldIncludeTargetSegment(element, data, depth)) {
      const segment: SemanticTargetSegment = {
        tagName: element.tagName.toLowerCase(),
        data,
      };
      const id = element.getAttribute('id');
      const role = element.getAttribute('role');
      const ariaLabel = element.getAttribute('aria-label');
      if (id) segment.id = id;
      if (role) segment.role = role;
      if (ariaLabel) segment.ariaLabel = ariaLabel;
      path.push(segment);
    }

    element = element.parentElement;
    depth += 1;
  }

  return path;
};

export const getRecentInteractionsForFreeze = (
  records: RendererInteractionRecord[],
  detectedAtMs: number,
  stallDurationMs: number
): RendererInteractionRecord[] => {
  const blockedSinceMs = detectedAtMs - stallDurationMs;
  const fallbackWindowMs = Math.max(RECENT_INTERACTION_FALLBACK_WINDOW_MS, stallDurationMs + SUSPECTED_INTERACTION_LOOKBACK_MS);
  return records.filter((record) => (
    record.monotonicTimeMs >= blockedSinceMs - fallbackWindowMs
    && record.monotonicTimeMs <= detectedAtMs
  ));
};

export const selectSuspectedInteraction = (
  records: RendererInteractionRecord[],
  detectedAtMs: number,
  stallDurationMs: number
): RendererInteractionRecord | null => {
  const blockedSinceMs = detectedAtMs - stallDurationMs;
  const nearBlockStart = records
    .filter((record) => (
      record.monotonicTimeMs >= blockedSinceMs - SUSPECTED_INTERACTION_LOOKBACK_MS
      && record.monotonicTimeMs <= blockedSinceMs + SUSPECTED_INTERACTION_LOOKAHEAD_MS
    ))
    .sort((left, right) => right.monotonicTimeMs - left.monotonicTimeMs);

  return nearBlockStart[0] ?? records[records.length - 1] ?? null;
};

export const getSafeKeyboardMetadata = (event: KeyboardEvent): { key: string; code?: string } => {
  if (SAFE_KEY_NAMES.has(event.key)) {
    return {
      key: event.key,
      code: event.code,
    };
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return {
      key: 'Shortcut',
      code: event.code,
    };
  }

  if (event.key.length === 1) {
    return { key: 'Printable' };
  }

  return { key: 'Other' };
};

const buildInteractionRecord = (event: Event, nowMs: number): RendererInteractionRecord | null => {
  if (!INTERACTION_EVENT_TYPES.includes(event.type as RendererInteractionEventType)) {
    return null;
  }

  const record: RendererInteractionRecord = {
    id: nextInteractionId,
    eventType: event.type as RendererInteractionEventType,
    timestamp: new Date().toISOString(),
    monotonicTimeMs: roundPerformanceValue(nowMs),
    targetPath: buildSemanticTargetPath(event.target),
  };
  nextInteractionId += 1;

  if (event instanceof KeyboardEvent) {
    const keyboardMetadata = getSafeKeyboardMetadata(event);
    record.key = keyboardMetadata.key;
    if (keyboardMetadata.code) {
      record.code = keyboardMetadata.code;
    }
    record.repeat = event.repeat;
    record.modifiers = {
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    };
  }

  if (event instanceof MouseEvent) {
    record.button = event.button;
  }

  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
    record.pointerType = event.pointerType;
  }

  if (event instanceof WheelEvent) {
    record.deltaX = roundPerformanceValue(event.deltaX);
    record.deltaY = roundPerformanceValue(event.deltaY);
  }

  if (typeof InputEvent !== 'undefined' && event instanceof InputEvent) {
    const inputElement = getElementFromTarget(event.target);
    if (inputElement instanceof HTMLInputElement || inputElement instanceof HTMLTextAreaElement) {
      record.inputValueLength = inputElement.value.length;
    }
  }

  if (typeof DragEvent !== 'undefined' && event instanceof DragEvent) {
    record.dropFileCount = event.dataTransfer?.files.length ?? 0;
  }

  return record;
};

const captureInteractionEvent = (event: Event): void => {
  const record = buildInteractionRecord(event, performance.now());
  if (!record) {
    return;
  }

  recentInteractions.push(record);
  while (recentInteractions.length > RECENT_INTERACTION_LIMIT) {
    recentInteractions.shift();
  }
};

const reportRendererFreeze = async (stallDurationMs: number, detectedAtMs: number): Promise<void> => {
  const severity = getRendererFreezeSeverity(stallDurationMs);
  if (!severity || reportingFreeze) {
    return;
  }

  reportingFreeze = true;
  try {
    const recent = getRecentInteractionsForFreeze(recentInteractions, detectedAtMs, stallDurationMs);
    const suspectedInteraction = selectSuspectedInteraction(recent, detectedAtMs, stallDurationMs);
    const mainProcessSnapshot = await requestMainProcessSnapshot();

    logger.warn('InteractionFreezeWatchdog', 'Renderer event-loop freeze detected', {
      event: 'interaction-freeze-detected',
      processRole: 'renderer',
      windowRole,
      severity,
      stallDurationMs: roundPerformanceValue(stallDurationMs),
      heartbeatIntervalMs: RENDERER_FREEZE_HEARTBEAT_INTERVAL_MS,
      blockedSincePerformanceMs: roundPerformanceValue(detectedAtMs - stallDurationMs),
      detectedAtPerformanceMs: roundPerformanceValue(detectedAtMs),
      suspectedInteraction,
      recentInteractions: recent.slice(-6),
      activeInteractions: getActiveInteractionPerformanceRecords(),
      rendererHeap: getRendererHeapSnapshot(),
      mainProcessSnapshot,
      renderer: {
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        visibilityState: document.visibilityState,
      },
      specialInteractionLog: true,
      requiresDebugging: true,
      freezeDetected: true,
    });
  } finally {
    reportingFreeze = false;
  }
};

const handleHeartbeat = (): void => {
  const nowMs = performance.now();
  const stallDurationMs = nowMs - lastHeartbeatAtMs - RENDERER_FREEZE_HEARTBEAT_INTERVAL_MS;
  lastHeartbeatAtMs = nowMs;

  if (getRendererFreezeSeverity(stallDurationMs)) {
    void reportRendererFreeze(stallDurationMs, nowMs);
  }
};

const supportsLongTaskObserver = (): boolean => {
  return typeof PerformanceObserver !== 'undefined'
    && Array.isArray(PerformanceObserver.supportedEntryTypes)
    && PerformanceObserver.supportedEntryTypes.includes('longtask');
};

const installLongTaskObserver = (): void => {
  if (!supportsLongTaskObserver()) {
    return;
  }

  longTaskObserver = new PerformanceObserver((entryList) => {
    for (const entry of entryList.getEntries()) {
      const severity = getRendererFreezeSeverity(entry.duration);
      if (!severity) {
        continue;
      }

      const detectedAtMs = entry.startTime + entry.duration;
      const recent = getRecentInteractionsForFreeze(recentInteractions, detectedAtMs, entry.duration);
      logger.warn('InteractionFreezeWatchdog', 'Renderer long task observed', {
        event: 'renderer-long-task-detected',
        processRole: 'renderer',
        windowRole,
        severity,
        taskDurationMs: roundPerformanceValue(entry.duration),
        taskStartPerformanceMs: roundPerformanceValue(entry.startTime),
        suspectedInteraction: selectSuspectedInteraction(recent, detectedAtMs, entry.duration),
        recentInteractions: recent.slice(-6),
        specialInteractionLog: true,
        requiresDebugging: true,
        freezeDetected: true,
      });
    }
  });

  longTaskObserver.observe({ entryTypes: ['longtask'] });
};

export const installInteractionFreezeWatchdog = (role: string): void => {
  if (installed) {
    return;
  }

  installed = true;
  windowRole = role;
  lastHeartbeatAtMs = performance.now();

  for (const eventType of INTERACTION_EVENT_TYPES) {
    window.addEventListener(eventType, captureInteractionEvent, { capture: true, passive: true });
  }

  heartbeatTimerId = window.setInterval(handleHeartbeat, RENDERER_FREEZE_HEARTBEAT_INTERVAL_MS);
  installLongTaskObserver();
  window.addEventListener('beforeunload', stopInteractionFreezeWatchdog, { once: true });
};

export const stopInteractionFreezeWatchdog = (): void => {
  if (heartbeatTimerId !== null) {
    window.clearInterval(heartbeatTimerId);
    heartbeatTimerId = null;
  }

  for (const eventType of INTERACTION_EVENT_TYPES) {
    window.removeEventListener(eventType, captureInteractionEvent, { capture: true });
  }

  longTaskObserver?.disconnect();
  longTaskObserver = null;
  installed = false;
  window.removeEventListener('beforeunload', stopInteractionFreezeWatchdog);
};

export const resetInteractionFreezeWatchdogForTests = (): void => {
  stopInteractionFreezeWatchdog();
  reportingFreeze = false;
  windowRole = 'main';
  nextInteractionId = 1;
  recentInteractions.length = 0;
};
