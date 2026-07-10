import { getVersion } from '@tauri-apps/api/app';
import {
  APP_DOWNLOADS_URL,
  APP_RELEASE_MANIFEST_URL,
  APP_WEBSITE_URL,
} from '@/config/appIdentity';
import { logger } from '@/services/logger';
import { tauriClient } from '@/lib/tauriClient';
import type {
  ReleaseDownloadOption,
  ReleaseManifest,
  UpdateAvailability,
  UpdateCheckResult,
  UpdateWindowPayload,
} from './appUpdateTypes';

const MANIFEST_FETCH_TIMEOUT_MS = 20_000;
const SUMMARY_MAX_LENGTH = 200;

const DOWNLOAD_ORDER = [
  'mac-arm64',
  'mac-x64',
  'windows-x64',
  'windows-arm64',
  'linux-x86_64-appimage',
  'linux-aarch64-appimage',
  'linux-x86_64-deb',
  'linux-aarch64-deb',
] as const;

let cachedManifest: ReleaseManifest | null = null;
let manifestFetchPromise: Promise<ReleaseManifest> | null = null;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseVersionParts(version: string): [number, number, number] | null {
  const normalized = normalizeVersion(version);
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(normalized);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareReleaseVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  if (!leftParts || !rightParts) {
    const leftNormalized = normalizeVersion(left);
    const rightNormalized = normalizeVersion(right);
    if (leftNormalized === rightNormalized) {
      return 0;
    }
    return leftNormalized < rightNormalized ? -1 : 1;
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
  }
  return 0;
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function truncateSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

export function pickRecommendedDownload(
  downloadOptions: ReleaseDownloadOption[] | undefined,
): ReleaseDownloadOption | null {
  if (!downloadOptions?.length) {
    return null;
  }

  const sorted = [...downloadOptions].sort((left, right) => {
    const leftIndex = DOWNLOAD_ORDER.indexOf(left.id as (typeof DOWNLOAD_ORDER)[number]);
    const rightIndex = DOWNLOAD_ORDER.indexOf(right.id as (typeof DOWNLOAD_ORDER)[number]);
    return (
      (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
      - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  });

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  const isMac = userAgent.includes('mac') || platform.includes('mac');
  const isWindows = userAgent.includes('win') || platform.includes('win');
  const isLinux = userAgent.includes('linux') || platform.includes('linux');
  const isLikelyArm = userAgent.includes('arm') || platform.includes('arm') || userAgent.includes('aarch64');

  if (isMac) {
    return sorted.find((option) => option.id === 'mac-arm64')
      ?? sorted.find((option) => option.platform === 'mac')
      ?? sorted[0];
  }

  if (isWindows) {
    return sorted.find((option) => option.id === (isLikelyArm ? 'windows-arm64' : 'windows-x64'))
      ?? sorted.find((option) => option.platform === 'windows')
      ?? sorted[0];
  }

  if (isLinux) {
    return sorted.find((option) => option.id === (isLikelyArm ? 'linux-aarch64-appimage' : 'linux-x86_64-appimage'))
      ?? sorted.find((option) => option.id === 'linux-x86_64-deb')
      ?? sorted.find((option) => option.platform === 'linux')
      ?? sorted[0];
  }

  return sorted[0] ?? null;
}

async function fetchReleaseManifest(): Promise<ReleaseManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }

  if (!manifestFetchPromise) {
    manifestFetchPromise = (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(APP_RELEASE_MANIFEST_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Release manifest request failed with ${response.status}`);
        }

        const manifest = await response.json() as ReleaseManifest;
        if (!manifest.version) {
          throw new Error('Release manifest is missing a version');
        }
        cachedManifest = manifest;
        return manifest;
      } finally {
        window.clearTimeout(timeoutId);
        manifestFetchPromise = null;
      }
    })();
  }

  return manifestFetchPromise;
}

function buildSummary(manifest: ReleaseManifest): string {
  if (manifest.notesUrl) {
    return truncateSummary(`See release notes on ${APP_WEBSITE_URL}.`);
  }
  return truncateSummary(`KiJi ${manifest.version} is available.`);
}

function resolveDownloadUrl(manifest: ReleaseManifest): string {
  const recommended = pickRecommendedDownload(manifest.downloadOptions);
  if (recommended?.url && isHttpsUrl(recommended.url)) {
    return recommended.url;
  }
  return APP_DOWNLOADS_URL;
}

function resolveNotesUrl(manifest: ReleaseManifest): string | undefined {
  if (manifest.notesUrl && isHttpsUrl(manifest.notesUrl)) {
    return manifest.notesUrl;
  }
  return undefined;
}

export async function getCurrentAppVersion(): Promise<string> {
  return getVersion();
}

export async function checkForUpdate(): Promise<UpdateAvailability | null> {
  const result = await checkForUpdateDetailed();
  if (result.status === 'available') {
    return result.availability;
  }
  return null;
}

export async function checkForUpdateDetailed(): Promise<UpdateCheckResult> {
  try {
    const [currentVersion, manifest] = await Promise.all([
      getCurrentAppVersion(),
      fetchReleaseManifest(),
    ]);

    if (compareReleaseVersions(manifest.version, currentVersion) <= 0) {
      return { status: 'up-to-date', currentVersion };
    }

    return {
      status: 'available',
      availability: {
        currentVersion,
        latestVersion: manifest.version,
        releasedAt: manifest.date,
        summary: buildSummary(manifest),
        downloadUrl: resolveDownloadUrl(manifest),
        notesUrl: resolveNotesUrl(manifest),
      },
    };
  } catch (error) {
    logger.warn('AppUpdate', 'Failed to check for updates', { error });
    return { status: 'error' };
  }
}

export function toUpdateWindowPayload(availability: UpdateAvailability): UpdateWindowPayload {
  return {
    currentVersion: availability.currentVersion,
    latestVersion: availability.latestVersion,
    releasedAt: availability.releasedAt,
    summary: availability.summary,
    downloadUrl: availability.downloadUrl,
    notesUrl: availability.notesUrl,
  };
}

export async function openUpdateWindow(payload: UpdateWindowPayload): Promise<void> {
  await tauriClient.shell.openUpdateWindow(payload);
}

export async function downloadUpdateArtifact(url: string): Promise<void> {
  if (!isHttpsUrl(url)) {
    throw new Error('Update download URL must use HTTPS');
  }
  await tauriClient.shell.openExternal({ url });
}
