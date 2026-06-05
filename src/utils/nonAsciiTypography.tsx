import React from 'react';

const CJK_CHARACTER_PATTERN = /[\p{Script=Han}\u3040-\u309F\u30A0-\u30FF\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;
const CJK_RUN_PATTERN = /[\p{Script=Han}\u3040-\u309F\u30A0-\u30FF\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]+|[^\p{Script=Han}\u3040-\u309F\u30A0-\u30FF\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]+/gu;
const DEFAULT_WRAP_EXCLUSION_SELECTOR = 'code, pre, kbd, samp, textarea, script, style';

interface TextRun {
  text: string;
  isCjk: boolean;
}

interface WrapNonAsciiTextNodesOptions {
  excludedAncestorSelector?: string;
  nonAsciiClassName?: string;
}

/**
 * Split text into consecutive CJK and non-CJK runs so renderers can swap
 * font families without affecting Roman/English text.
 */
export function splitTextByAsciiRuns(text: string): TextRun[] {
  if (!text) {
    return [];
  }

  const parts = text.match(CJK_RUN_PATTERN) ?? [text];
  return parts.map((part) => ({
    text: part,
    isCjk: CJK_CHARACTER_PATTERN.test(part),
  }));
}

/**
 * Render plain text while routing only CJK runs through the dedicated
 * reading-font class.
 */
export function renderTextWithNonAsciiFont(text: string, keyPrefix = 'text'): React.ReactNode {
  return splitTextByAsciiRuns(text).map((run, index) => (
    run.isCjk
      ? (
        <span key={`${keyPrefix}-non-ascii-${index}`} className="article-text-non-ascii">
          {run.text}
        </span>
      )
      : <React.Fragment key={`${keyPrefix}-ascii-${index}`}>{run.text}</React.Fragment>
  ));
}

/**
 * Preserve existing search highlights while still swapping the font only for
 * matched CJK glyph runs.
 */
export function renderHighlightedTextWithNonAsciiFont(
  text: string,
  query: string,
  keyPrefix = 'text'
): React.ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return renderTextWithNonAsciiFont(text, keyPrefix);
  }

  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const queryLower = normalizedQuery.toLowerCase();

  return text
    .split(regex)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const renderedPart = renderTextWithNonAsciiFont(part, `${keyPrefix}-${index}`);
      return part.toLowerCase() === queryLower
        ? (
          <mark key={`${keyPrefix}-highlight-${index}`} className="article-list-match-highlight">
            {renderedPart}
          </mark>
        )
        : <React.Fragment key={`${keyPrefix}-part-${index}`}>{renderedPart}</React.Fragment>;
    });
}

/**
 * Wrap CJK text nodes inside existing HTML content so article body HTML can
 * reuse the same dedicated font without rewriting the surrounding markup.
 */
export function wrapNonAsciiTextNodes(
  container: ParentNode,
  options: WrapNonAsciiTextNodesOptions = {}
): void {
  const excludedAncestorSelector = options.excludedAncestorSelector ?? DEFAULT_WRAP_EXCLUSION_SELECTOR;
  const nonAsciiClassName = options.nonAsciiClassName ?? 'article-text-non-ascii';
  const ownerDocument = container.ownerDocument ?? document;
  const textNodes: Text[] = [];

  const walker = ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const textNode = node as Text;
        const text = textNode.textContent ?? '';
        if (!CJK_CHARACTER_PATTERN.test(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        const parentElement = textNode.parentElement;
        if (!parentElement) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parentElement.closest(excludedAncestorSelector)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  for (let currentNode = walker.nextNode(); currentNode; currentNode = walker.nextNode()) {
    textNodes.push(currentNode as Text);
  }

  // Snapshot the text nodes before mutating so replacements never interfere
  // with the active TreeWalker traversal.
  textNodes.forEach((textNode) => {
    const parentNode = textNode.parentNode;
    if (!parentNode) {
      return;
    }

    const runs = splitTextByAsciiRuns(textNode.textContent ?? '');
    if (!runs.some((run) => run.isCjk)) {
      return;
    }

    const fragment = ownerDocument.createDocumentFragment();
    runs.forEach((run) => {
      if (run.text.length === 0) {
        return;
      }

      if (run.isCjk) {
        const span = ownerDocument.createElement('span');
        span.className = nonAsciiClassName;
        span.textContent = run.text;
        fragment.appendChild(span);
        return;
      }

      fragment.appendChild(ownerDocument.createTextNode(run.text));
    });

    parentNode.replaceChild(fragment, textNode);
  });
}
