function hasInlineImage(html: string): boolean {
  if (!html) return false;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return !!doc.body.querySelector('img, picture, figure img');
  } catch {
    return /<(img|picture)\b/i.test(html);
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function injectLeadImage(content: string, imageUrl: string | undefined): string {
  if (!imageUrl || hasInlineImage(content)) {
    return content;
  }

  const figureHtml = `<figure><img src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async" /></figure>`;
  return content.trim() ? `${figureHtml}${content}` : figureHtml;
}
