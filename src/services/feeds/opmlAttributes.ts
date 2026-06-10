export const OPML_EMOJI_ATTRIBUTE = 'kijiEmoji';
export const OPML_STATION_NAME_ATTRIBUTE = 'kijiStationName';

export const LEGACY_OPML_FEED_EMOJI_ATTRIBUTE = 'kijiFeedEmoji';
export const LEGACY_OPML_STATION_EMOJI_ATTRIBUTE = 'kijiStationEmoji';
export const LEGACY_OPML_STATION_NAME_ATTRIBUTE = 'feedoneStationName';

type OpmlAttributeSource = Element | Record<string, string | undefined>;

const readAttribute = (source: OpmlAttributeSource, name: string): string | undefined => {
  if (typeof Element !== 'undefined' && source instanceof Element) {
    const value = source.getAttribute(name);
    return value?.trim() || undefined;
  }

  const value = (source as Record<string, string | undefined>)[name];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
};

export const readOpmlOutlineEmoji = (outline: OpmlAttributeSource): string | undefined => (
  readAttribute(outline, OPML_EMOJI_ATTRIBUTE)
  || readAttribute(outline, LEGACY_OPML_FEED_EMOJI_ATTRIBUTE)
  || readAttribute(outline, LEGACY_OPML_STATION_EMOJI_ATTRIBUTE)
);
