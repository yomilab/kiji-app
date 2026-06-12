import * as tauriClient from '@/lib/tauriClient/feeds';

const PDF_FETCH_TIMEOUT_MS = 60_000;

export type PdfInlineLoadResult =
  | { bytes: Uint8Array }
  | { error: string };

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Invalid data URL');
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function formatPdfLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('too large')) {
    return 'PDF is too large to display inline.';
  }
  return 'Could not load PDF.';
}

export async function loadPdfBytes(url: string): Promise<PdfInlineLoadResult> {
  try {
    const response = await tauriClient.fetchPdfDataUrl({
      url,
      timeout: PDF_FETCH_TIMEOUT_MS,
    });
    if (!response.dataUrl) {
      return { error: 'Could not load PDF.' };
    }
    const bytes = dataUrlToBytes(response.dataUrl);
    if (bytes.length === 0) {
      return { error: 'Could not load PDF.' };
    }
    return { bytes };
  } catch (error) {
    return { error: formatPdfLoadError(error) };
  }
}
