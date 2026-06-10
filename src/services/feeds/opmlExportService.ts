import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import type { Tag } from '@/types/tag';
import {
  OPML_EMOJI_ATTRIBUTE,
  OPML_STATION_NAME_ATTRIBUTE,
} from './opmlAttributes';

const xmlEscape = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const normalizeLabel = (value?: string): string => {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
};

const buildFeedSortLabel = (feed: Feed): string => {
  const title = normalizeLabel(feed.title) || normalizeLabel(feed.url);
  const emoji = normalizeLabel(feed.emoji);
  if (!emoji) return title;
  return `${emoji} ${title}`.trim();
};

const buildFeedOutline = (feed: Feed): string => {
  const title = normalizeLabel(feed.title) || normalizeLabel(feed.url);
  const emoji = normalizeLabel(feed.emoji);
  const attributes = [
    'type="rss"',
    `title="${xmlEscape(title)}"`,
    `text="${xmlEscape(title)}"`,
    `xmlUrl="${xmlEscape(feed.url)}"`,
    `htmlUrl="${xmlEscape(feed.url)}"`,
  ];

  if (emoji) {
    attributes.push(`${OPML_EMOJI_ATTRIBUTE}="${xmlEscape(emoji)}"`);
  }

  return `<outline ${attributes.join(' ')} />`;
};

const sortFeedsByLabel = (feeds: Feed[]): Feed[] => {
  return [...feeds].sort((a, b) => {
    const aLabel = buildFeedSortLabel(a);
    const bLabel = buildFeedSortLabel(b);
    return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  });
};

class OpmlExportService {
  async buildOpmlText(): Promise<string> {
    const [allFeeds, allTags] = await Promise.all([
      feedsManager.getAllFeeds(),
      tagsManager.getAllTags(),
    ]);

    const feedById = new Map(allFeeds.map((feed) => [feed.id, feed]));
    const tagByName = new Map(allTags.map((tag) => [tag.name, tag]));
    const stationNamesByFeedId = new Map<string, string[]>();

    for (const tag of allTags) {
      for (const feedId of tag.feedIds) {
        const existingNames = stationNamesByFeedId.get(feedId) || [];
        existingNames.push(tag.name);
        stationNamesByFeedId.set(feedId, existingNames);
      }
    }

    const sortedTags = [...allTags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const bodyLines: string[] = [];

    for (const tag of sortedTags) {
      const memberFeeds = sortFeedsByLabel(
        tag.feedIds
          .map((feedId) => feedById.get(feedId))
          .filter((feed): feed is Feed => Boolean(feed))
      );

      if (memberFeeds.length === 0) continue;

      const stationName = normalizeLabel(tag.name);
      const stationEmoji = normalizeLabel(tag.emoji);
      const stationAttrs = [
        `title="${xmlEscape(stationName)}"`,
        `text="${xmlEscape(stationName)}"`,
        `${OPML_STATION_NAME_ATTRIBUTE}="${xmlEscape(stationName)}"`,
      ];

      if (stationEmoji) {
        stationAttrs.push(`${OPML_EMOJI_ATTRIBUTE}="${xmlEscape(stationEmoji)}"`);
      }

      bodyLines.push(`  <outline ${stationAttrs.join(' ')}>`);
      for (const feed of memberFeeds) {
        bodyLines.push(`    ${buildFeedOutline(feed)}`);
      }
      bodyLines.push('  </outline>');
    }

    const unstationedFeeds = sortFeedsByLabel(
      allFeeds.filter((feed) => {
        const stationNames = stationNamesByFeedId.get(feed.id) || [];
        return stationNames
          .map((name) => tagByName.get(name))
          .filter((tag): tag is Tag => Boolean(tag)).length === 0;
      })
    );

    for (const feed of unstationedFeeds) {
      bodyLines.push(`  ${buildFeedOutline(feed)}`);
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      '<head>',
      '<title>KiJi Feeds</title>',
      '</head>',
      '<body>',
      ...bodyLines,
      '</body>',
      '</opml>',
      '',
    ].join('\n');
  }
}

export const opmlExportService = new OpmlExportService();
