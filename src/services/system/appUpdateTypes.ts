export interface ReleaseDownloadOption {
  id: string;
  platform: string;
  label: string;
  detail?: string;
  fileType?: string;
  fileName: string;
  version: string;
  url: string;
  size?: number;
}

export interface ReleaseManifest {
  productName?: string;
  version: string;
  tag?: string;
  date?: string;
  notesUrl?: string;
  updatesFeedUrl?: string;
  checksumsUrl?: string;
  downloadOptions?: ReleaseDownloadOption[];
}

export interface UpdateAvailability {
  currentVersion: string;
  latestVersion: string;
  releasedAt?: string;
  summary: string;
  downloadUrl: string;
  notesUrl?: string;
}

export interface UpdateWindowPayload {
  currentVersion: string;
  latestVersion: string;
  releasedAt?: string;
  summary: string;
  downloadUrl: string;
  notesUrl?: string;
}

export type UpdateCheckResult =
  | { status: 'available'; availability: UpdateAvailability }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'error' };
