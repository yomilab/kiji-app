import { invoke } from '@tauri-apps/api/core';

export interface KijiE2eConfig {
  dir: string;
  feedUrl: string;
  feedId: string;
  schedulerIntervalMs: number;
}

interface E2eHarnessConfigResponse {
  dir: string;
  feedUrl: string;
  feedId: string;
  schedulerIntervalMs: number;
}

let cachedConfig: KijiE2eConfig | null | undefined;

function normalizeConfig(config: E2eHarnessConfigResponse): KijiE2eConfig {
  return {
    dir: config.dir,
    feedUrl: config.feedUrl,
    feedId: config.feedId,
    schedulerIntervalMs: config.schedulerIntervalMs,
  };
}

async function readE2eConfigFromBackend(): Promise<KijiE2eConfig | null> {
  try {
    const response = await invoke<E2eHarnessConfigResponse | null>('e2e_get_config');
    if (!response?.feedUrl) {
      return null;
    }
    return normalizeConfig(response);
  } catch {
    return null;
  }
}

export function getE2eConfig(): KijiE2eConfig | null {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const raw = (globalThis as Record<string, unknown>).__KIJI_E2E__;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const config = raw as Partial<KijiE2eConfig>;
  if (typeof config.dir !== 'string' || config.dir.length === 0) {
    return null;
  }

  return {
    dir: config.dir,
    feedUrl: typeof config.feedUrl === 'string' ? config.feedUrl : '',
    feedId: typeof config.feedId === 'string' ? config.feedId : 'e2e-feed',
    schedulerIntervalMs: typeof config.schedulerIntervalMs === 'number'
      ? config.schedulerIntervalMs
      : Number(config.schedulerIntervalMs ?? 500),
  };
}

export async function waitForE2eConfig(timeoutMs = 30_000): Promise<KijiE2eConfig | null> {
  const immediate = await readE2eConfigFromBackend();
  if (!immediate) {
    cachedConfig = null;
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    cachedConfig = getE2eConfig() ?? immediate;
    (globalThis as Record<string, unknown>).__KIJI_E2E__ = cachedConfig;
    return cachedConfig;
  }

  cachedConfig = immediate;
  (globalThis as Record<string, unknown>).__KIJI_E2E__ = immediate;
  return immediate;
}

export async function writeE2eEvent(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const config = cachedConfig ?? getE2eConfig() ?? await readE2eConfigFromBackend();
  if (!config) {
    return;
  }

  await invoke('e2e_write_event', {
    name,
    payloadJson: JSON.stringify(payload),
  });
}
