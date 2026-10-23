import React, { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { setStoryFeedResponses } from '@/stories/storyFeedResponses';
import { AddFeedModal } from './AddFeedModal';

const SITE_URL = 'https://fieldnotes.example';
const SITE_HTML = `<!DOCTYPE html><html><head><title>Field Notes</title>
  <link rel="alternate" type="application/atom+xml" title="Field Notes" href="/feeds/main">
  <link rel="alternate" type="application/rss+xml" title="Links only" href="/linked/feed.rss">
  <link rel="alternate" type="application/feed+json" title="Field Notes (JSON)" href="https://fieldnotes.example/feeds/json">
  <link rel="alternate" type="application/rss+xml" title="Field Notes Podcast" href="https://podcast.fieldnotes.example/rss">
</head><body></body></html>`;

/** Types a link into the modal as a user would, then lets the lookup run. */
const TypeLinkOnMount: React.FC<{ value: string }> = ({ value }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.add-feed-input');
      if (!input) return;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [value]);
  return null;
};

const meta = {
  title: 'Theme Debug/Add Feeds',
  component: AddFeedModal,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    isOpen: true,
    onClose: () => {},
    onFeedAdded: () => {},
  },
} satisfies Meta<typeof AddFeedModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SeveralFeedsOnAPage: Story = {
  render: (args) => {
    setStoryFeedResponses({ [SITE_URL]: SITE_HTML });
    return (
      <div className="theme-debug-surface">
        <AddFeedModal {...args} />
        <TypeLinkOnMount value="fieldnotes.example" />
      </div>
    );
  },
};
