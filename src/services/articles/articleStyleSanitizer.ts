const BLOCKED_STYLE_PROPERTIES = [
  /^color$/i,
  /^background(?:-.+)?$/i,
  /^font(?:-.+)?$/i,
  /^line-height$/i,
  /^letter-spacing$/i,
  /^text-shadow$/i,
  /^width$/i,
  /^height$/i,
  /^max-width$/i,
  /^min-width$/i,
  /^max-height$/i,
  /^min-height$/i,
  /^margin(?:-.+)?$/i,
  /^padding(?:-.+)?$/i,
  /^position$/i,
  /^(?:top|right|bottom|left)$/i,
  /^float$/i,
  /^clear$/i,
  /^transform(?:-.+)?$/i,
  /^aspect-ratio$/i,
  /^object-fit$/i,
];

const PRESENTATIONAL_ATTRIBUTES = [
  'color',
  'bgcolor',
  'face',
  'size',
];

const WIDTH_HEIGHT_ATTRIBUTE_SELECTORS = [
  'img',
  'picture',
  'source',
  'video',
  'iframe',
  'embed',
  'object',
  'figure',
  'table',
  'col',
  'colgroup',
  'td',
  'th',
];

const isBlockedStyleProperty = (property: string): boolean => {
  const normalized = property.trim().toLowerCase();
  if (!normalized) return false;
  return BLOCKED_STYLE_PROPERTIES.some((pattern) => pattern.test(normalized));
};

const sanitizeInlineStyle = (styleValue: string | undefined): string | null => {
  if (!styleValue) return null;

  const safeDeclarations = styleValue
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex <= 0) return false;
      const property = entry.slice(0, separatorIndex).trim();
      return !isBlockedStyleProperty(property);
    });

  if (safeDeclarations.length === 0) {
    return null;
  }

  return safeDeclarations.join('; ');
};

// Phase 1 (first paint): run synchronously in renderer so article content
// is theme-safe before the async preprocess task completes.
export const sanitizeArticleHtmlStyles = (html: string): string => {
  if (!html.trim()) return html;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('style').forEach((styleTag) => styleTag.remove());

    doc.querySelectorAll<HTMLElement>('*[style]').forEach((element) => {
      const sanitizedStyle = sanitizeInlineStyle(element.getAttribute('style') || undefined);
      if (!sanitizedStyle) {
        element.removeAttribute('style');
        return;
      }
      element.setAttribute('style', sanitizedStyle);
    });

    doc.querySelectorAll<HTMLElement>('*').forEach((element) => {
      PRESENTATIONAL_ATTRIBUTES.forEach((attribute) => {
        element.removeAttribute(attribute);
      });
    });

    doc.querySelectorAll<HTMLElement>(WIDTH_HEIGHT_ATTRIBUTE_SELECTORS.join(',')).forEach((element) => {
      element.removeAttribute('width');
      element.removeAttribute('height');
    });

    return doc.body.innerHTML || html;
  } catch {
    return html;
  }
};

