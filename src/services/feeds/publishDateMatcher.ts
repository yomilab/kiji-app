import {
  resolvePublishedDate,
  type NormalizePublishedDateOptions,
} from "../articles/publishedDateNormalizer";
import { getTextValue } from "./feedValueExtractor";

export interface DateFieldCandidate {
  fieldName: string;
  value: string;
  score: number;
}

export interface MatchPublishedDateInput {
  explicit?: Array<string | null | undefined>;
  source?: unknown;
  options?: NormalizePublishedDateOptions;
}

export interface MatchUpdatedDateInput {
  explicit?: Array<string | null | undefined>;
  source?: unknown;
  options?: NormalizePublishedDateOptions;
}

/** Ordered publish-date keywords (higher index = lower priority when scores tie). */
export const PUBLISH_DATE_KEYWORDS = [
  "published",
  "pubdate",
  "datepublished",
  "date_published",
  "issued",
  "created",
  "creation",
  "updated",
  "modified",
  "lastmod",
  "lastmodified",
  "last_modified",
  "postdate",
  "post_date",
  "released",
  "timestamp",
  "datetime",
  "date",
  "time",
] as const;

/** Ordered updated-date keywords. */
export const UPDATED_DATE_KEYWORDS = [
  "updated",
  "modified",
  "lastmod",
  "lastmodified",
  "last_modified",
  "datemodified",
  "date_modified",
  "timestamp",
  "datetime",
  "date",
] as const;

/** Substrings that disqualify a field name even when it contains a date keyword. */
export const DATE_FIELD_BLOCKLIST = [
  "duration",
  "timezone",
  "timedelta",
  "expir",
  "copyright",
  "runtime",
  "readingtime",
  "readtime",
] as const;

const MAX_OBJECT_SCAN_DEPTH = 4;

export function normalizeDateFieldName(fieldName: string): string {
  const localName = fieldName.includes(":") ? fieldName.split(":").pop() ?? fieldName : fieldName;
  return localName.replace(/[-_\s]/g, "").toLowerCase();
}

export function isBlockedDateFieldName(fieldName: string): boolean {
  const normalized = normalizeDateFieldName(fieldName);
  return DATE_FIELD_BLOCKLIST.some((blocked) => normalized.includes(blocked));
}

export function scorePublishDateField(fieldName: string): number | null {
  if (isBlockedDateFieldName(fieldName)) {
    return null;
  }

  const normalized = normalizeDateFieldName(fieldName);
  for (let index = 0; index < PUBLISH_DATE_KEYWORDS.length; index += 1) {
    const keyword = PUBLISH_DATE_KEYWORDS[index];
    if (normalized === keyword || normalized.includes(keyword)) {
      return PUBLISH_DATE_KEYWORDS.length - index;
    }
  }
  return null;
}

export function scoreUpdatedDateField(fieldName: string): number | null {
  if (isBlockedDateFieldName(fieldName)) {
    return null;
  }

  const normalized = normalizeDateFieldName(fieldName);
  for (let index = 0; index < UPDATED_DATE_KEYWORDS.length; index += 1) {
    const keyword = UPDATED_DATE_KEYWORDS[index];
    if (normalized === keyword || normalized.includes(keyword)) {
      return UPDATED_DATE_KEYWORDS.length - index;
    }
  }
  return null;
}

export function collectPublishDateFieldsFromObject(
  source: unknown,
  maxDepth = MAX_OBJECT_SCAN_DEPTH,
): DateFieldCandidate[] {
  const candidates: DateFieldCandidate[] = [];
  walkObjectForDateFields(source, "", 0, maxDepth, scorePublishDateField, candidates);
  return sortDateFieldCandidates(candidates);
}

export function collectUpdatedDateFieldsFromObject(
  source: unknown,
  maxDepth = MAX_OBJECT_SCAN_DEPTH,
): DateFieldCandidate[] {
  const candidates: DateFieldCandidate[] = [];
  walkObjectForDateFields(source, "", 0, maxDepth, scoreUpdatedDateField, candidates);
  return sortDateFieldCandidates(candidates);
}

export function collectPublishDateFieldsFromElement(element: Element): DateFieldCandidate[] {
  const candidates: DateFieldCandidate[] = [];

  for (const child of Array.from(element.children)) {
    const fieldName = child.localName || child.tagName.split(":").pop() || child.tagName;
    const value = child.textContent?.trim();
    if (!value) {
      continue;
    }

    const score = scorePublishDateField(fieldName);
    if (score !== null) {
      candidates.push({ fieldName, value, score });
    }
  }

  return sortDateFieldCandidates(candidates);
}

export function collectUpdatedDateFieldsFromElement(element: Element): DateFieldCandidate[] {
  const candidates: DateFieldCandidate[] = [];

  for (const child of Array.from(element.children)) {
    const fieldName = child.localName || child.tagName.split(":").pop() || child.tagName;
    const value = child.textContent?.trim();
    if (!value) {
      continue;
    }

    const score = scoreUpdatedDateField(fieldName);
    if (score !== null) {
      candidates.push({ fieldName, value, score });
    }
  }

  return sortDateFieldCandidates(candidates);
}

export function matchPublishedDate(input: MatchPublishedDateInput = {}): string | undefined {
  const fromExplicit = resolvePublishedDate(input.explicit ?? [], input.options);
  if (fromExplicit) {
    return fromExplicit;
  }

  if (input.source === undefined) {
    return undefined;
  }

  const candidates = collectPublishDateFieldsFromObject(input.source);
  return resolvePublishedDate(
    candidates.map((candidate) => candidate.value),
    input.options,
  );
}

export function matchUpdatedDate(input: MatchUpdatedDateInput = {}): string | undefined {
  const fromExplicit = resolvePublishedDate(input.explicit ?? [], input.options);
  if (fromExplicit) {
    return fromExplicit;
  }

  if (input.source === undefined) {
    return undefined;
  }

  const candidates = collectUpdatedDateFieldsFromObject(input.source);
  return resolvePublishedDate(
    candidates.map((candidate) => candidate.value),
    input.options,
  );
}

export function matchPublishedDateFromElement(
  element: Element,
  input: Omit<MatchPublishedDateInput, "source"> = {},
): string | undefined {
  const fromExplicit = resolvePublishedDate(input.explicit ?? [], input.options);
  if (fromExplicit) {
    return fromExplicit;
  }

  const candidates = collectPublishDateFieldsFromElement(element);
  return resolvePublishedDate(
    candidates.map((candidate) => candidate.value),
    input.options,
  );
}

export function matchUpdatedDateFromElement(
  element: Element,
  input: Omit<MatchUpdatedDateInput, "source"> = {},
): string | undefined {
  const fromExplicit = resolvePublishedDate(input.explicit ?? [], input.options);
  if (fromExplicit) {
    return fromExplicit;
  }

  const candidates = collectUpdatedDateFieldsFromElement(element);
  return resolvePublishedDate(
    candidates.map((candidate) => candidate.value),
    input.options,
  );
}

export interface FeedDateEnrichmentResult {
  domParserUsed: boolean;
  elementCount: number;
  enrichedCount: number;
}

export function enrichFeedItemsWithMatchedDates(items: FeedItemLike[], rawXml: string): FeedDateEnrichmentResult {
  const missingDates = items.filter((item) => !item.publishedDate);
  if (missingDates.length === 0) {
    return { domParserUsed: false, elementCount: 0, enrichedCount: 0 };
  }

  const xmlDoc = new DOMParser().parseFromString(rawXml, "text/xml");
  if (xmlDoc.querySelector("parsererror")) {
    return { domParserUsed: true, elementCount: 0, enrichedCount: 0 };
  }

  const elements = Array.from(xmlDoc.querySelectorAll("item, entry"));
  if (elements.length === 0) {
    return { domParserUsed: true, elementCount: 0, enrichedCount: 0 };
  }

  let enrichedCount = 0;
  items.forEach((item, index) => {
    if (item.publishedDate) {
      return;
    }

    const element = findMatchingFeedElement(elements, item, index);
    if (!element) {
      return;
    }

    item.publishedDate = matchPublishedDateFromElement(element);
    if (item.publishedDate) {
      enrichedCount += 1;
    }
    if (!item.updatedDate) {
      item.updatedDate = matchUpdatedDateFromElement(element);
    }
  });

  return { domParserUsed: true, elementCount: elements.length, enrichedCount };
}

interface FeedItemLike {
  publishedDate?: string;
  updatedDate?: string;
  link?: string;
  guid?: string;
  id?: string;
}

function walkObjectForDateFields(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  scoreField: (fieldName: string) => number | null,
  candidates: DateFieldCandidate[],
): void {
  if (depth > maxDepth || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    const fieldName = path.split(".").pop() ?? path;
    const arrayScore = fieldName ? scoreField(fieldName) : null;

    for (const entry of value) {
      const text = getTextValue(entry);
      if (text && arrayScore !== null) {
        candidates.push({ fieldName, value: text, score: arrayScore });
        continue;
      }
      walkObjectForDateFields(entry, path, depth + 1, maxDepth, scoreField, candidates);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const text = getTextValue(child);
    if (text) {
      const score = scoreField(key);
      if (score !== null) {
        candidates.push({ fieldName: key, value: text, score });
      }
      continue;
    }

    walkObjectForDateFields(child, path ? `${path}.${key}` : key, depth + 1, maxDepth, scoreField, candidates);
  }
}

function sortDateFieldCandidates(candidates: DateFieldCandidate[]): DateFieldCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.fieldName.localeCompare(right.fieldName);
  });
}

function findMatchingFeedElement(
  elements: Element[],
  item: FeedItemLike,
  index: number,
): Element | undefined {
  const identifiers = [item.guid, item.id, item.link].filter(Boolean) as string[];

  for (const identifier of identifiers) {
    const match = elements.find((element) => elementContainsIdentifier(element, identifier));
    if (match) {
      return match;
    }
  }

  return elements[index];
}

function elementContainsIdentifier(element: Element, identifier: string): boolean {
  const normalized = identifier.trim();
  if (!normalized) {
    return false;
  }

  const idText = element.querySelector("id")?.textContent?.trim();
  if (idText === normalized) {
    return true;
  }

  const guidText = element.querySelector("guid")?.textContent?.trim();
  if (guidText === normalized) {
    return true;
  }

  const linkText = element.querySelector("link")?.textContent?.trim();
  if (linkText === normalized) {
    return true;
  }

  const linkHref = Array.from(element.querySelectorAll("link"))
    .map((link) => link.getAttribute("href")?.trim())
    .find((href) => href === normalized);
  return !!linkHref;
}
