export interface FaviconPixelMetrics {
  width: number;
  height: number;
  opaquePixelCount: number;
  opaquePixelRatio: number;
  nearWhiteOpaqueRatio: number;
  uniqueOpaqueColors: number;
}

interface ParsedIcoMetadata {
  width: number;
  height: number;
  colorCount: number;
  bitCount: number;
  byteLength: number;
  imageCount: number;
}

function decodeBase64(base64: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
  } catch {
    return null;
  }

  return null;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function extractIcoMetadata(dataUrl: string): ParsedIcoMetadata | null {
  const match = /^data:image\/(?:x-icon|vnd\.microsoft\.icon);base64,([^#?]+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const bytes = decodeBase64(match[1]);
  if (!bytes || bytes.length < 22) {
    return null;
  }

  const reserved = readUint16LE(bytes, 0);
  const type = readUint16LE(bytes, 2);
  const imageCount = readUint16LE(bytes, 4);
  if (reserved !== 0 || type !== 1 || imageCount < 1) {
    return null;
  }

  return {
    width: bytes[6] || 256,
    height: bytes[7] || 256,
    colorCount: bytes[8],
    bitCount: readUint16LE(bytes, 12),
    byteLength: bytes.length,
    imageCount,
  };
}

/** Tiny monochrome ICO files are often generic blank placeholders (e.g. TechCrunch origin favicon.ico). */
export function isLowQualityIcoDataUrl(dataUrl: string): boolean {
  const metadata = extractIcoMetadata(dataUrl);
  if (!metadata) {
    return false;
  }

  return (
    metadata.imageCount === 1
    && metadata.width <= 16
    && metadata.height <= 16
    && metadata.byteLength <= 256
    && (metadata.bitCount <= 4 || (metadata.colorCount > 0 && metadata.colorCount <= 4))
  );
}

export function isTrivialRasterDataUrl(dataUrl: string): boolean {
  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) {
    return false;
  }

  const match = /^data:image\/[^;]+;base64,([^#?]+)/i.exec(dataUrl);
  if (!match) {
    return false;
  }

  const bytes = decodeBase64(match[1]);
  return bytes !== null && bytes.length < 80;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode favicon image'));
    image.src = src;
  });
}

export async function analyzeFaviconPixels(dataUrl: string): Promise<FaviconPixelMetrics | null> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) {
    return null;
  }

  try {
    const image = await loadImage(dataUrl);
    const sampleSize = 32;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const totalPixels = sampleSize * sampleSize;
    let opaquePixelCount = 0;
    let nearWhiteOpaqueCount = 0;
    const opaqueColors = new Set<string>();

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha <= 16) {
        continue;
      }

      opaquePixelCount += 1;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      opaqueColors.add(`${red},${green},${blue}`);

      if (red >= 245 && green >= 245 && blue >= 245) {
        nearWhiteOpaqueCount += 1;
      }
    }

    return {
      width: image.naturalWidth || sampleSize,
      height: image.naturalHeight || sampleSize,
      opaquePixelCount,
      opaquePixelRatio: opaquePixelCount / totalPixels,
      nearWhiteOpaqueRatio: opaquePixelCount > 0 ? nearWhiteOpaqueCount / opaquePixelCount : 0,
      uniqueOpaqueColors: opaqueColors.size,
    };
  } catch {
    return null;
  }
}

/** Pixel-only placeholder rules (used after ICO/trivial-raster gates). Exported for fixture accuracy tests. */
export function isPlaceholderFromPixelMetrics(metrics: FaviconPixelMetrics): boolean {
  const {
    width,
    height,
    opaquePixelCount,
    opaquePixelRatio,
    nearWhiteOpaqueRatio,
    uniqueOpaqueColors,
  } = metrics;
  const totalPixels = width * height;

  if (width < 3 || height < 3) {
    return true;
  }

  if (totalPixels >= 64 && opaquePixelCount < 8) {
    return true;
  }

  if (opaquePixelRatio < 0.06) {
    return true;
  }

  if (
    opaquePixelRatio >= 0.02
    && nearWhiteOpaqueRatio >= 0.97
    && uniqueOpaqueColors <= 4
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true when a fetched favicon is likely a blank/generic placeholder rather than a real brand mark.
 * Conservative thresholds: solid-color brand icons and multi-color logos should pass.
 */
export async function isPlaceholderFaviconDataUrl(dataUrl: string): Promise<boolean> {
  if (!dataUrl.startsWith('data:image/')) {
    return true;
  }

  if (dataUrl.startsWith('data:image/svg')) {
    return dataUrl.length < 120;
  }

  if (isLowQualityIcoDataUrl(dataUrl) || isTrivialRasterDataUrl(dataUrl)) {
    return true;
  }

  const metrics = await analyzeFaviconPixels(dataUrl);
  if (!metrics) {
    return true;
  }

  return isPlaceholderFromPixelMetrics(metrics);
}

export async function isUsableFaviconDataUrl(dataUrl: string): Promise<boolean> {
  return !(await isPlaceholderFaviconDataUrl(dataUrl));
}
