import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { extractArticleContentFromHtml } from '@/services/articles/articleExtractionService';
import { preprocessArticleViewHtml } from '@/services/articles/articleViewPreprocessTask';
import { discoverFaviconDataUrl } from '@/services/favicons/faviconDiscovery';
import {
  LEGACY_OPML_STATION_NAME_ATTRIBUTE,
  OPML_STATION_NAME_ATTRIBUTE,
  readOpmlOutlineEmoji,
} from '@/services/feeds/opmlAttributes';
import {
  deriveOpmlDefaultStationName,
  isFlatOpmlRoot,
  normalizeStationName,
  resolveOutlineStationName,
} from '@/services/feeds/opmlStationResolution';
import { filenameService } from '@/services/text/filenameService';
import { tauriClient } from '@/lib/tauriClient';
import {
  HELPER_TASK_KIND,
  type ArticleViewPreprocessTaskPayload,
  type FaviconFetchTaskPayload,
  type FaviconFetchTaskResult,
  type HelperTaskAnyResult,
  type HelperTaskExecutionInput,
  type OpmlParseTaskPayload,
  type OpmlParseTaskResult,
  type ParsedOpmlEntry,
  type SavedArticlesBulkUrlFetchTaskPayload,
  type SavedArticlesBulkUrlFetchTaskResult,
  type SavedArticlesCsvParseTaskPayload,
  type SavedArticlesExportTaskPayload,
  type SavedArticlesExportTaskResult,
  type SavedArticlesImportTaskPayload,
  type SavedArticlesImportTaskResult,
  type SavedArticlesUrlFetchTaskPayload,
  type SavedArticlesUrlFetchTaskResult,
} from '@/services/tasks/helperTaskContracts';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

type ImportedSavedArticle = SavedArticlesImportTaskResult['articles'][number];

const parseGenericCsvForUrls = (csvText: string): string[] => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 1) return [];

  const headerRow = lines[0].toLowerCase().split(',');
  const urlIndex = headerRow.findIndex((header) => header.trim().includes('url'));

  if (urlIndex === -1) {
    throw new Error("CSV must have a 'url' column");
  }

  const urls: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!matches) continue;

    const values = matches.map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (values[urlIndex]) {
      urls.push(values[urlIndex].trim());
    }
  }
  return urls;
};

const parsePocketCsv = (csvText: string): ImportedSavedArticle[] => {
  const lines = csvText.split(/\r?\n/);
  const results: ImportedSavedArticle[] = [];
  const header = lines[0]?.split(',');

  if (!header || header.length < 2) return [];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!matches) continue;

    const values = matches.map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (values.length < 2) continue;

    results.push({
      title: values[0],
      url: values[1],
      timeAdded: parseInt(values[2] || '0', 10),
      tags: values[3] ? values[3].split('|') : [],
      status: values[4] || 'unread',
    });
  }
  return results;
};

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

interface OpmlOutlineNode {
  text?: string;
  title?: string;
  xmlUrl?: string;
  outline?: OpmlOutlineNode | OpmlOutlineNode[];
}

const getOutlineLabel = (outline: OpmlOutlineNode): string => {
  return (outline.title || outline.text || '').trim();
};

const getOutlineStationName = (outline: OpmlOutlineNode): string | undefined => {
  const attributes = outline as Record<string, string | undefined>;
  return attributes[OPML_STATION_NAME_ATTRIBUTE] || attributes[LEGACY_OPML_STATION_NAME_ATTRIBUTE];
};

const parseOpmlTask = (payload: OpmlParseTaskPayload): OpmlParseTaskResult => {
  const opmlText = payload.opmlText.trim();
  if (!opmlText) {
    throw new Error('OPML file is empty.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(opmlText) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid OPML file.');
  }

  const opmlRoot = (parsed.opml || parsed) as Record<string, unknown>;
  const body = opmlRoot.body as Record<string, unknown> | undefined;

  if (!body) {
    throw new Error('Invalid OPML file: missing body section.');
  }

  const rootOutlines = toArray(body.outline as OpmlOutlineNode | OpmlOutlineNode[] | undefined);
  const rootOutlineHasXmlUrl = rootOutlines.map((outline) => Boolean(outline.xmlUrl?.trim()));
  const head = opmlRoot.head as Record<string, unknown> | undefined;
  const opmlHeadTitle = typeof head?.title === 'string' ? head.title : undefined;
  const flatImportStation = isFlatOpmlRoot(rootOutlineHasXmlUrl)
    ? (
      normalizeStationName(payload.defaultStationName)
      ?? deriveOpmlDefaultStationName({
        fileName: payload.fileName,
        url: payload.url,
        opmlHeadTitle,
      })
    )
    : undefined;
  const entries: ParsedOpmlEntry[] = [];

  const walkOutline = (
    outline: OpmlOutlineNode,
    topStation: string | undefined,
    topStationEmoji: string | undefined,
    depth: number,
    rootOutlineIndex: number,
  ) => {
    const label = getOutlineLabel(outline);
    const xmlUrl = outline.xmlUrl?.trim();
    const stationName = resolveOutlineStationName({
      depth,
      hasXmlUrl: Boolean(xmlUrl),
      label,
      explicitStationName: getOutlineStationName(outline),
      inheritedStation: topStation,
      flatImportStation,
    });
    const stationEmoji = depth === 0
      ? readOpmlOutlineEmoji(outline as Record<string, string | undefined>)
      : topStationEmoji;

    if (xmlUrl) {
      entries.push({
        url: xmlUrl,
        title: label || undefined,
        station: stationName,
        emoji: readOpmlOutlineEmoji(outline as Record<string, string | undefined>),
        stationEmoji,
        rootOutlineIndex,
      });
    }

    const childOutlines = toArray(outline.outline);
    for (const child of childOutlines) {
      walkOutline(child, stationName, stationEmoji, depth + 1, rootOutlineIndex);
    }
  };

  rootOutlines.forEach((outline, rootOutlineIndex) => {
    walkOutline(outline, undefined, undefined, 0, rootOutlineIndex);
  });

  return { entries };
};

const fetchDataUrl = async (url: string, signal?: AbortSignal): Promise<string | null> => {
  if (signal?.aborted) {
    return null;
  }

  try {
    const response = await tauriClient.feeds.fetchDataUrl({ url });
    return response.dataUrl;
  } catch {
    return null;
  }
};

const fetchText = async (url: string, signal?: AbortSignal): Promise<string> => {
  if (signal?.aborted) {
    throw new DOMException('Task aborted', 'AbortError');
  }

  return tauriClient.feeds.fetch({ url });
};

const fetchHtmlForUrl = async (url: string, signal: AbortSignal): Promise<string> => {
  if (signal.aborted) {
    throw new DOMException('Task aborted', 'AbortError');
  }

  if (window.electronAPI?.fetchHtmlSafe) {
    const result = await window.electronAPI.fetchHtmlSafe(url);
    if (result.resourceType !== 'html' || !result.html) {
      throw new Error(`Non-HTML content type: ${result.contentType}`);
    }
    return result.html;
  }

  return fetchText(url, signal);
};

const fetchFaviconTask = async (
  payload: FaviconFetchTaskPayload,
  signal: AbortSignal,
): Promise<FaviconFetchTaskResult> => {
  const defaultResult: FaviconFetchTaskResult = {
    feedId: payload.feedId,
    favicon: null,
  };

  let targetUrl: URL;
  try {
    targetUrl = new URL(payload.feedUrl);
  } catch {
    return defaultResult;
  }

  const favicon = await discoverFaviconDataUrl(targetUrl.toString(), {
    fetchImageDataUrl: fetchDataUrl,
    fetchText,
  }, {
    signal,
  });

  return {
    feedId: payload.feedId,
    favicon,
  };
};

const exportSavedArticlesTask = async (
  payload: SavedArticlesExportTaskPayload,
): Promise<SavedArticlesExportTaskResult> => {
  const zip = new JSZip();
  let csvContent = 'title,url,time_added,tags,status\n';
  const articlesFolder = zip.folder('articles');

  for (const article of payload.articles) {
    const timeAdded = Math.floor(
      new Date(article.savedDate || article.fetchedDate || Date.now()).getTime() / 1000,
    );
    const safeTitle = filenameService.normalizeTitle(article.title || 'Untitled');
    const escapedTitle = safeTitle.replace(/"/g, '""');
    csvContent += `"${escapedTitle}","${article.link || ''}",${timeAdded},,"unread"\n`;

    const content = article.content || article.description || '';
    let markdownBody = '';
    try {
      markdownBody = content ? turndown.turndown(content) : '';
    } catch {
      markdownBody = content;
    }

    const markdown = `# ${safeTitle}\nSource: ${article.link || 'unknown'}\n\n---\n\n${markdownBody}`;
    const fileName = `${filenameService.sanitizeFilename(safeTitle)}.md`;
    articlesFolder?.file(fileName, markdown);
  }

  zip.file('pocket.csv', csvContent);
  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
  return { zipArrayBuffer: zipBuffer };
};

const importSavedArticlesTask = async (
  payload: SavedArticlesImportTaskPayload,
): Promise<SavedArticlesImportTaskResult> => {
  const zip = await JSZip.loadAsync(payload.zipArrayBuffer);
  const csvFile = zip.file('pocket.csv');

  if (!csvFile) {
    throw new Error('Missing pocket.csv in ZIP');
  }

  const csvText = await csvFile.async('text');
  const articles = parsePocketCsv(csvText);
  const articlesFolder = zip.folder('articles');

  if (articlesFolder) {
    for (const article of articles) {
      const fileName = `${filenameService.sanitizeFilename(article.title)}.md`;
      const mdFile = articlesFolder.file(fileName);
      if (!mdFile) continue;

      const mdText = await mdFile.async('text');
      const parts = mdText.split('---\n\n');
      if (parts.length > 1) {
        article.content = parts.slice(1).join('---\n\n').trim();
      }
    }
  }

  return { articles };
};

const fetchUrlMetadataTask = async (
  payload: SavedArticlesUrlFetchTaskPayload,
  signal: AbortSignal,
): Promise<SavedArticlesUrlFetchTaskResult> => {
  const { url, parser } = payload;
  const html = await fetchHtmlForUrl(url, signal);
  const result = await extractArticleContentFromHtml(url, html, parser);

  if (!result) {
    throw new Error('Failed to parse article');
  }

  return {
    url: result.url,
    title: result.title,
    author: result.author,
    datePublished: result.datePublished,
    content: result.content,
    excerpt: result.excerpt,
    leadImageUrl: result.leadImageUrl,
    domain: result.domain,
  };
};

const fetchBulkUrlMetadataTask = async (
  payload: SavedArticlesBulkUrlFetchTaskPayload,
  signal: AbortSignal,
): Promise<SavedArticlesBulkUrlFetchTaskResult> => {
  const { urls, concurrency = 3, parser } = payload;
  const results: SavedArticlesUrlFetchTaskResult[] = [];
  const queue = [...urls];

  const workers = Array(Math.min(concurrency, urls.length)).fill(null).map(async () => {
    while (queue.length > 0 && !signal.aborted) {
      const nextUrl = queue.shift();
      if (!nextUrl) break;

      try {
        const metadata = await fetchUrlMetadataTask({ url: nextUrl, parser }, signal);
        results.push(metadata);
      } catch (error) {
        console.warn(`Failed to fetch metadata for ${nextUrl} in bulk task:`, error);
      }
    }
  });

  await Promise.all(workers);
  return { results };
};

export const runHelperTask = async (
  input: HelperTaskExecutionInput,
  signal?: AbortSignal,
): Promise<HelperTaskAnyResult> => {
  const abortSignal = signal || new AbortController().signal;

  switch (input.kind) {
    case HELPER_TASK_KIND.OPML_PARSE:
      return parseOpmlTask(input.payload as OpmlParseTaskPayload);
    case HELPER_TASK_KIND.FAVICON_FETCH:
      return fetchFaviconTask(input.payload as FaviconFetchTaskPayload, abortSignal);
    case HELPER_TASK_KIND.SAVED_ARTICLES_EXPORT:
      return exportSavedArticlesTask(input.payload as SavedArticlesExportTaskPayload);
    case HELPER_TASK_KIND.SAVED_ARTICLES_IMPORT:
      return importSavedArticlesTask(input.payload as SavedArticlesImportTaskPayload);
    case HELPER_TASK_KIND.SAVED_ARTICLES_CSV_PARSE:
      return {
        urls: parseGenericCsvForUrls((input.payload as SavedArticlesCsvParseTaskPayload).csvText),
      };
    case HELPER_TASK_KIND.SAVED_ARTICLES_URL_FETCH:
      return fetchUrlMetadataTask(input.payload as SavedArticlesUrlFetchTaskPayload, abortSignal);
    case HELPER_TASK_KIND.SAVED_ARTICLES_BULK_URL_FETCH:
      return fetchBulkUrlMetadataTask(
        input.payload as SavedArticlesBulkUrlFetchTaskPayload,
        abortSignal,
      );
    case HELPER_TASK_KIND.ARTICLE_VIEW_PREPROCESS:
      return preprocessArticleViewHtml(input.payload as ArticleViewPreprocessTaskPayload);
    default:
      throw new Error(`Unsupported helper task kind: ${input.kind}`);
  }
};
