export interface FaviconAppearance {
  hasTransparency: boolean;
  dominantColor: string | null;
  containerBgLight: string | null;
  containerBgDark: string | null;
}

export async function analyzeFaviconAppearance(dataUrl: string): Promise<FaviconAppearance> {
  if (!dataUrl.startsWith("data:image/")) {
    return {
      hasTransparency: false,
      dominantColor: null,
      containerBgLight: null,
      containerBgDark: null,
    };
  }

  try {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let hasTransparency = false;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha < 250) {
        hasTransparency = true;
      }
      if (alpha > 16) {
        red += pixels[index];
        green += pixels[index + 1];
        blue += pixels[index + 2];
        count += 1;
      }
    }

    const dominantColor = count > 0
      ? `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})`
      : null;

    return {
      hasTransparency,
      dominantColor,
      containerBgLight: hasTransparency ? "rgba(255, 255, 255, 0.78)" : null,
      containerBgDark: hasTransparency ? "rgba(255, 255, 255, 0.12)" : null,
    };
  } catch {
    return {
      hasTransparency: false,
      dominantColor: null,
      containerBgLight: null,
      containerBgDark: null,
    };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode favicon image"));
    image.src = src;
  });
}
