import { tauriClient } from '@/lib/tauriClient';
import type { AppSettings, AppSettingsPatch } from '@/lib/settings';
import { DEFAULT_SETTINGS as DEFAULT_NATIVE_SETTINGS } from '@/lib/settings';

let cachedNativeSettings: AppSettings | null = null;

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // `TAURI_ENV_PLATFORM` is a CLI hook env var and is not injected into the Vite
  // client bundle, so runtime detection must use the Tauri internals marker.
  return '__TAURI_INTERNALS__' in window
    || typeof import.meta.env.TAURI_ENV_PLATFORM === 'string';
}

export async function loadNativeAppSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return cachedNativeSettings ?? DEFAULT_NATIVE_SETTINGS;
  }

  try {
    cachedNativeSettings = await tauriClient.settings.get();
    return cachedNativeSettings;
  } catch (error) {
    console.error('Failed to load native app settings:', error);
    return cachedNativeSettings ?? DEFAULT_NATIVE_SETTINGS;
  }
}

export async function saveNativeAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    cachedNativeSettings = {
      ...(cachedNativeSettings ?? DEFAULT_NATIVE_SETTINGS),
      ...patch,
      windowSize: {
        ...(cachedNativeSettings?.windowSize ?? DEFAULT_NATIVE_SETTINGS.windowSize),
        ...(patch.windowSize ?? {}),
      },
    };
    return cachedNativeSettings;
  }

  try {
    cachedNativeSettings = await tauriClient.settings.update(patch);
    return cachedNativeSettings;
  } catch (error) {
    console.error('Failed to save native app settings:', error);
    throw error;
  }
}

export function primeNativeAppSettingsCache(settings: AppSettings): void {
  cachedNativeSettings = settings;
}
