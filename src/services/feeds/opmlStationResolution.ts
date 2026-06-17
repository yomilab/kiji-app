const GENERIC_OPML_HEAD_TITLES = new Set([
  'export from plenary',
  'feeds',
  'subscriptions',
  'opml export',
  'my opml',
]);

export const normalizeStationName = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\.opml$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || undefined;
};

export const deriveOpmlDefaultStationName = (source: {
  fileName?: string;
  url?: string;
  opmlHeadTitle?: string;
}): string | undefined => {
  if (source.fileName) {
    const fromFile = normalizeStationName(source.fileName);
    if (fromFile) {
      return fromFile;
    }
  }

  if (source.url) {
    try {
      const segment = decodeURIComponent(new URL(source.url).pathname.split('/').pop() || '');
      const fromUrl = normalizeStationName(segment);
      if (fromUrl) {
        return fromUrl;
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  if (source.opmlHeadTitle) {
    const fromHead = normalizeStationName(source.opmlHeadTitle);
    if (fromHead && !GENERIC_OPML_HEAD_TITLES.has(fromHead.toLowerCase())) {
      return fromHead;
    }
  }

  return undefined;
};

export const resolveOutlineStationName = (args: {
  depth: number;
  hasXmlUrl: boolean;
  label: string;
  explicitStationName?: string;
  inheritedStation?: string;
  flatImportStation?: string;
}): string | undefined => {
  const explicitStation = normalizeStationName(args.explicitStationName);

  if (args.depth === 0) {
    if (args.hasXmlUrl) {
      return explicitStation ?? args.flatImportStation;
    }

    return explicitStation ?? normalizeStationName(args.label);
  }

  return args.inheritedStation;
};

export const isFlatOpmlRoot = (rootOutlineHasXmlUrl: boolean[]): boolean => (
  rootOutlineHasXmlUrl.length > 0 && rootOutlineHasXmlUrl.every(Boolean)
);
