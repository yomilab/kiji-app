import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReaderFailureNotice } from './ReaderFailureNotice';
import './ArticleView.css';

const FeedCopy = () => (
  <p>
    Between weak earnings, preelection jitters, and a historic crypto hack, investors in high-growth
    assets may feel like they have nowhere to turn.
  </p>
);

const meta = {
  title: 'Article View/Reader Failure Notice',
  component: ReaderFailureNotice,
  parameters: { layout: 'fullscreen' },
  args: {
    failure: 'blocked',
    hasFeedCopy: true,
    onRetry: () => {},
    onOpenInBrowser: () => {},
  },
  decorators: [
    (Story, context) => (
      <div style={{ padding: 32, background: 'var(--theme-article-bg, var(--theme-bg-primary))', minHeight: '100vh', boxSizing: 'border-box' }}>
        <div className="article-view-body" style={{ maxWidth: 'var(--max-article-content-width, 680px)', margin: '0 auto' }}>
          <Story />
          {context.args.hasFeedCopy ? <FeedCopy /> : null}
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderFailureNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blocked: Story = {};
export const Unreachable: Story = { args: { failure: 'unreachable' } };
export const NotFound: Story = { args: { failure: 'not-found' } };
export const NoFeedCopy: Story = { args: { hasFeedCopy: false } };
