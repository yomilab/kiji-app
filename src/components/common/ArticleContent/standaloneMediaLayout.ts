/**
 * Block layout classification for article content (shadow DOM).
 *
 * Only top-level blocks of the content container are classified, so nested
 * reading contexts (quotes, lists, tables) keep their normal flow.
 *
 * - Standalone image (own line: a top-level <img>/<picture>/link, or a
 *   <p>/<figure>/<div> holding exactly one image and no text outside a
 *   <figcaption>) → `ac-media-bleed`: at least column width, growing toward its
 *   natural width and at most `--article-media-bleed` past each column edge.
 *   After load, small images fall back to `ac-media-natural` and tall
 *   portraits to `ac-media-portrait`.
 * - Standalone video / iframe / lite-youtube → `ac-media-bleed` (always full bleed).
 * - Block holding 2+ images and no text → `ac-media-gallery` (grid, bleed width).
 * - Top-level <table>/<pre> → `ac-block-wide`: may widen into the bleed only as
 *   far as its content needs.
 * - First substantial top-level paragraph → `ac-lead`.
 * - Images in bleed/gallery blocks show a tinted placeholder until loaded
 *   (`ac-img-pending`), then fade in (`ac-img-reveal`). Cached images skip both.
 *
 * `--article-media-bleed` is computed by the host from the scroll width, so it
 * shrinks to keep an edge gap when the window narrows.
 *
 * Before any of that, the `auto` keyword is dropped from `sizes` (WordPress emits
 * it on lazy images). The sanitizer strips width/height, and WebKit then lays
 * such an image out at the 150px fallback height, squashing it into its width.
 */

export const MEDIA_BLEED_CLASS = 'ac-media-bleed';
export const MEDIA_NATURAL_CLASS = 'ac-media-natural';
export const MEDIA_PORTRAIT_CLASS = 'ac-media-portrait';
export const MEDIA_GALLERY_CLASS = 'ac-media-gallery';
export const BLOCK_WIDE_CLASS = 'ac-block-wide';
export const LEAD_CLASS = 'ac-lead';
export const IMG_PENDING_CLASS = 'ac-img-pending';
export const IMG_REVEAL_CLASS = 'ac-img-reveal';
export const NATURAL_WIDTH_VAR = '--ac-natural-width';

const MEDIA_LAYOUT_CLASSES = [MEDIA_BLEED_CLASS, MEDIA_NATURAL_CLASS, MEDIA_PORTRAIT_CLASS, MEDIA_GALLERY_CLASS];
const MEDIA_LAYOUT_SELECTOR = MEDIA_LAYOUT_CLASSES.map((name) => `.${name}`).join(', ');

/** Images narrower than this fraction of the column keep their natural size. */
const MIN_STRETCH_RATIO = 0.5;
/** Images taller than this height/width ratio are treated as portraits. */
const PORTRAIT_RATIO = 1.25;
/** Minimum text length for the first paragraph to be styled as a lead. */
const LEAD_MIN_TEXT_CHARS = 80;
/** Only the first few top-level blocks are considered for the lead paragraph. */
const LEAD_SEARCH_LIMIT = 3;

const EMBED_SELECTOR = 'iframe, video, lite-youtube';
/** Ancestors that keep media in the text flow (no breakout inside them). */
const NESTED_CONTEXT_TAGS = new Set(['BLOCKQUOTE', 'LI', 'UL', 'OL', 'TABLE', 'PRE', 'ASIDE']);
const WRAPPER_TAGS = new Set(['P', 'FIGURE', 'DIV', 'A', 'PICTURE', 'SPAN', 'CENTER']);
const NON_MEDIA_BLOCK_SELECTOR = 'table, pre, ul, ol, blockquote, h1, h2, h3, h4, h5, h6';

/** Walks from `element` to its top-level ancestor through plain wrappers only. */
function findTopLevelBlock(container: Element, element: Element): Element | null {
  let block: Element = element;
  while (block.parentElement && block.parentElement !== container) {
    const parent = block.parentElement;
    if (NESTED_CONTEXT_TAGS.has(parent.tagName) || !WRAPPER_TAGS.has(parent.tagName)) {
      return null;
    }
    block = parent;
  }
  return block.parentElement === container ? block : null;
}

/** True when the block has no text outside captions and embedded players. */
function hasNoProse(block: Element): boolean {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && !node.parentElement?.closest('figcaption, lite-youtube, button')) {
      return false;
    }
  }
  return true;
}

function isAlreadyClassified(block: Element): boolean {
  return MEDIA_LAYOUT_CLASSES.some((name) => block.classList.contains(name));
}

/** Returns the top-level block a standalone image should lay out as, or null. */
export function findStandaloneMediaBlock(container: Element, image: HTMLImageElement): Element | null {
  const block = findTopLevelBlock(container, image);
  if (!block || block === image) {
    return block;
  }
  if (block.querySelectorAll('img').length !== 1) return null;
  if (block.querySelector(`${EMBED_SELECTOR}, ${NON_MEDIA_BLOCK_SELECTOR}`)) return null;
  return hasNoProse(block) ? block : null;
}

/** Returns the top-level block for a standalone video/iframe/lite-youtube, or null. */
export function findStandaloneEmbedBlock(container: Element, embed: Element): Element | null {
  const block = findTopLevelBlock(container, embed);
  if (!block || block === embed) {
    return block;
  }
  if (block.querySelectorAll(EMBED_SELECTOR).length !== 1) return null;
  if (block.querySelector(NON_MEDIA_BLOCK_SELECTOR)) return null;
  if (Array.from(block.querySelectorAll('img')).some((image) => !image.closest('lite-youtube'))) return null;
  return hasNoProse(block) ? block : null;
}

/** True when a top-level block is an image-only gallery (2+ images, one per grid cell). */
export function isGalleryBlock(block: Element): boolean {
  if (!WRAPPER_TAGS.has(block.tagName) || block.tagName === 'A' || block.tagName === 'PICTURE') return false;
  const images = block.querySelectorAll('img');
  if (images.length < 2) return false;
  if (block.querySelector(`${EMBED_SELECTOR}, ${NON_MEDIA_BLOCK_SELECTOR}`)) return false;
  if (!hasNoProse(block)) return false;

  // Each grid cell (direct child, captions aside) must hold exactly one image.
  const cells = Array.from(block.children).filter((child) => child.tagName !== 'FIGCAPTION' && child.tagName !== 'BR');
  if (cells.length !== images.length) return false;
  return cells.every((cell) => cell.tagName === 'IMG' || cell.querySelectorAll('img').length === 1);
}

function parseLengthAttribute(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && !value.trim().endsWith('%') ? parsed : null;
}

/**
 * Apply size-based downgrades once intrinsic dimensions are known.
 * `columnWidth` is the current text column width in CSS px (0 when unknown).
 */
export function applyIntrinsicMediaSize(
  block: HTMLElement,
  naturalWidth: number,
  naturalHeight: number,
  columnWidth: number,
): void {
  if (naturalWidth <= 0 || block.classList.contains(MEDIA_GALLERY_CLASS)) return;

  block.style.setProperty(NATURAL_WIDTH_VAR, `${naturalWidth}px`);

  if (columnWidth > 0 && naturalWidth < columnWidth * MIN_STRETCH_RATIO) {
    block.classList.remove(MEDIA_BLEED_CLASS, MEDIA_PORTRAIT_CLASS);
    block.classList.add(MEDIA_NATURAL_CLASS);
    return;
  }

  if (naturalHeight > naturalWidth * PORTRAIT_RATIO) {
    block.classList.remove(MEDIA_BLEED_CLASS, MEDIA_NATURAL_CLASS);
    block.classList.add(MEDIA_PORTRAIT_CLASS);
  }
}

/** Removes a leading `auto` from `sizes`, keeping the author's fallback sizes when present. */
function removeAutoImageSizes(container: Element): void {
  container.querySelectorAll('img[sizes], source[sizes]').forEach((element) => {
    const [first, ...fallback] = (element.getAttribute('sizes') ?? '').split(',');
    if (first.trim().toLowerCase() !== 'auto') return;
    const fallbackSizes = fallback.join(',').trim();
    if (fallbackSizes) {
      element.setAttribute('sizes', fallbackSizes);
    } else {
      element.removeAttribute('sizes');
    }
  });
}

function markImageLoading(image: HTMLImageElement): void {
  if (image.complete && image.naturalWidth > 0) return;
  image.classList.add(IMG_PENDING_CLASS);
}

function classifyImages(container: Element, columnWidth: number): void {
  container.querySelectorAll('img').forEach((imageElement) => {
    const image = imageElement as HTMLImageElement;
    const block = findStandaloneMediaBlock(container, image) as HTMLElement | null;
    if (!block || isAlreadyClassified(block)) return;

    block.classList.add(MEDIA_BLEED_CLASS);

    // Author-declared small widths (e.g. width="120") keep their natural size up front.
    const declaredWidth = parseLengthAttribute(image.getAttribute('width'));
    if (declaredWidth) {
      applyIntrinsicMediaSize(block, declaredWidth, parseLengthAttribute(image.getAttribute('height')) ?? 0, columnWidth);
    }
    if (image.complete && image.naturalWidth > 0) {
      applyIntrinsicMediaSize(block, image.naturalWidth, image.naturalHeight, columnWidth);
    }
    // Placeholder only where the image is laid out at column width or wider.
    if (block.classList.contains(MEDIA_BLEED_CLASS)) {
      markImageLoading(image);
    }
  });
}

function classifyEmbeds(container: Element): void {
  container.querySelectorAll(EMBED_SELECTOR).forEach((embed) => {
    if (embed.tagName === 'IFRAME' && embed.closest('lite-youtube')) return;
    const block = findStandaloneEmbedBlock(container, embed);
    if (!block || isAlreadyClassified(block)) return;
    block.classList.add(MEDIA_BLEED_CLASS);
  });
}

function classifyTopLevelBlocks(container: Element): void {
  let leadCandidates = LEAD_SEARCH_LIMIT;
  let leadAssigned = container.querySelector(`:scope > .${LEAD_CLASS}`) !== null;

  for (const child of Array.from(container.children)) {
    const tag = child.tagName;

    if (tag === 'TABLE' || tag === 'PRE') {
      child.classList.add(BLOCK_WIDE_CLASS);
    } else if (!isAlreadyClassified(child) && isGalleryBlock(child)) {
      child.classList.add(MEDIA_GALLERY_CLASS);
      child.querySelectorAll('img').forEach((image) => markImageLoading(image as HTMLImageElement));
    }

    if (!leadAssigned && leadCandidates > 0) {
      leadCandidates -= 1;
      if (tag === 'P' && !child.querySelector('img') && (child.textContent?.trim().length ?? 0) >= LEAD_MIN_TEXT_CHARS) {
        child.classList.add(LEAD_CLASS);
        leadAssigned = true;
      }
    }
  }
}

/**
 * Classify freshly rendered content. Idempotent: safe to call again after
 * deferred media enhancements replace iframes with lite-youtube placeholders.
 * Images that are already decoded (cache hits) are sized immediately; the rest
 * are sized by the host's capturing `load` listener via `handleStandaloneMediaLoad`.
 */
export function classifyStandaloneMedia(container: Element, columnWidth: number): void {
  removeAutoImageSizes(container);
  classifyTopLevelBlocks(container);
  classifyImages(container, columnWidth);
  classifyEmbeds(container);
}

export function handleStandaloneMediaLoad(image: HTMLImageElement, columnWidth: number): void {
  if (image.classList.contains(IMG_PENDING_CLASS)) {
    image.classList.remove(IMG_PENDING_CLASS);
    image.classList.add(IMG_REVEAL_CLASS);
  }
  const block = image.closest(MEDIA_LAYOUT_SELECTOR) as HTMLElement | null;
  if (!block) return;
  applyIntrinsicMediaSize(block, image.naturalWidth, image.naturalHeight, columnWidth);
}

/**
 * Images that open in the lightbox: laid-out (standalone or gallery) images
 * that are not links. Returned in document order.
 */
export function collectLightboxImages(container: Element): HTMLImageElement[] {
  return Array.from(container.querySelectorAll(`:scope > :is(${MEDIA_LAYOUT_SELECTOR}) img, :scope > img:is(${MEDIA_LAYOUT_SELECTOR})`))
    .filter((image): image is HTMLImageElement => image instanceof HTMLImageElement && !image.closest('a[href]') && !!image.src);
}
