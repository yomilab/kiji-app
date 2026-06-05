export interface SavedArticlesExportPreflight {
  articleCount: number;
  estimatedUncompressedBytes: number;
  estimatedZipBytes: number;
  freeBytes: number | null;
  exceedsOneGb: boolean;
  exceedsFreeSpace: boolean;
}

export interface SavedArticlesExportStartRequest {
  outputPath: string;
}

export interface SavedArticlesExportStartResponse {
  started: boolean;
  jobId?: string;
  reason?: 'busy';
}

export interface SavedArticlesExportCompletedPayload {
  outputPath: string;
  articleCount: number;
  writtenBytes: number;
  durationMs: number;
}

export type SavedArticlesExportEvent =
  | {
      jobId: string;
      status: 'progress';
      phase: 'starting' | 'exporting' | 'finalizing';
      articleCount: number;
      processedArticles: number;
      writtenBytes?: number;
      message: string;
    }
  | {
      jobId: string;
      status: 'completed';
      message: string;
      result: SavedArticlesExportCompletedPayload;
    }
  | {
      jobId: string;
      status: 'failed';
      message: string;
      error: string;
    };
