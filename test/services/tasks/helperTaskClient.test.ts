import { describe, expect, it } from 'vitest';
import { helperTaskClient } from '@/services/tasks/helperTaskClient';
import { HELPER_TASK_KIND } from '@/services/tasks/helperTaskContracts';

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>KiJi Feeds</title>
  </head>
  <body>
    <outline title="Daily" text="Daily" kijiStationName="Daily">
      <outline type="rss" title="Example Feed" text="Example Feed" xmlUrl="https://example.com/feed.xml" />
    </outline>
  </body>
</opml>`;

describe('helperTaskClient', () => {
  it('resolves fast OPML parse tasks after enqueueing', async () => {
    const result = await helperTaskClient.runTask({
      kind: HELPER_TASK_KIND.OPML_PARSE,
      priority: 'high',
      payload: { opmlText: SAMPLE_OPML },
    });

    expect(result.entries).toEqual([
      {
        title: 'Example Feed',
        url: 'https://example.com/feed.xml',
        station: 'Daily',
        emoji: undefined,
        stationEmoji: undefined,
        rootOutlineIndex: 0,
      },
    ]);
  });
});
