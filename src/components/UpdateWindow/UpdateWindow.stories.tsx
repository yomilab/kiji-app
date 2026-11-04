import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
// Relative path: Storybook aliases `@/services/settings` (and its subpaths) to a data mock.
import { findReaderTheme } from '../../services/settings/readerThemes';
import { WindowCaptionButtons } from '@/components/WindowChrome/WindowCaptionButtons';
import { UpdateWindowView } from './UpdateWindowView';

const CURRENT_VERSION = '1.5.0';

// Shape of `release.json` notes generated from CHANGELOG.md.
const AVAILABLE_UPDATE = {
  currentVersion: CURRENT_VERSION,
  latestVersion: '1.6.0',
  releasedAt: '2026-10-12T09:00:00Z',
  summary: '',
  sections: [
    {
      title: 'New',
      items: [
        'Article view redesign: wide images and videos use the side margins, image-only rows become a gallery, and images open in a full-window lightbox.',
        'Published date and reading time under the article title, with a thin reading-progress bar.',
      ],
    },
    {
      title: 'Improved',
      items: [
        'Background refresh keeps every slot busy, so one slow feed no longer holds up the rest of your library.',
      ],
    },
    {
      title: 'Fixed',
      items: [
        'Podcast and video feeds no longer show a broken image as the article cover.',
        'YouTube videos in articles open on youtube.com instead of failing with Error 153.',
        'Feeds in Japanese, Chinese and other non-UTF-8 encodings load instead of failing every time.',
      ],
    },
  ],
  downloadUrl: 'https://example.com/kiji-1.6.0.dmg',
  notesUrl: 'https://reader.yomilab.app/changelog/#v1.6.0',
};

const meta = {
  title: 'Theme Debug/Update Window',
  component: UpdateWindowView,
  parameters: {
    layout: 'centered',
    // Like production: the Reader theme toolbar recolors the accent only.
    kiji: { readerThemeScope: 'accent' },
  },
  args: {
    currentVersion: CURRENT_VERSION,
    status: { kind: 'up-to-date' },
    onDownload: fn(),
    onOpenNotes: fn(),
    onRetryCheck: fn(),
    onRetryPayload: fn(),
    onClose: fn(),
  },
  render: (args, { globals }) => {
    const readerTheme = findReaderTheme(globals.readerTheme);
    return (
      <UpdateWindowView
        {...args}
        readerAccent={readerTheme ? { themeId: readerTheme.id, scheme: globals.theme === 'dark' ? 'dark' : 'light' } : null}
      />
    );
  },
  decorators: [
    (Story, { globals }) => (
      // Same fixed size as the `update` window in tauri.conf.json.
      <div className="theme-debug-update-frame">
        {/* Production: native traffic lights (macOS) or <TrafficLights /> captions. That
            component reads data-os during render, before the theme decorator sets it. */}
        {globals.platform === 'windows' || globals.platform === 'linux'
          ? <WindowCaptionButtons className="window-caption-buttons-fixed" />
          : <span className="theme-debug-macos-traffic-lights" aria-hidden="true"><i /><i /><i /></span>}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateWindowView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpdateAvailable: Story = {
  args: {
    status: { kind: 'available', update: AVAILABLE_UPDATE },
  },
};

/** Manifests published before release notes existed: no list, generic summary. */
export const LegacyManifest: Story = {
  args: {
    status: {
      kind: 'available',
      update: {
        ...AVAILABLE_UPDATE,
        sections: [],
        summary: 'See release notes on https://reader.yomilab.app.',
      },
    },
  },
};

export const SummaryAndSingleFix: Story = {
  args: {
    status: {
      kind: 'available',
      update: {
        ...AVAILABLE_UPDATE,
        latestVersion: '1.5.1',
        releasedAt: undefined,
        notesUrl: undefined,
        summary: 'A small reliability release.',
        sections: [{ title: 'Fixed', items: ['Security update for a bundled TLS library (rustls).'] }],
      },
    },
  },
};

export const LongNotes: Story = {
  args: {
    status: {
      kind: 'available',
      update: {
        ...AVAILABLE_UPDATE,
        latestVersion: '2.0.0-beta.12',
        sections: AVAILABLE_UPDATE.sections.map((section) => ({
          ...section,
          items: [...section.items, ...section.items, ...section.items],
        })),
      },
    },
  },
};

export const Checking: Story = {
  args: {
    status: { kind: 'checking' },
  },
};

export const UpToDate: Story = {
  args: {
    status: { kind: 'up-to-date' },
  },
};

export const CheckError: Story = {
  args: {
    status: { kind: 'check-error', message: 'The release server could not be reached. Check your connection.' },
  },
};

export const LoadingPayload: Story = {
  args: {
    status: { kind: 'loading' },
  },
};

export const PayloadError: Story = {
  args: {
    status: { kind: 'payload-error', message: 'Timed out waiting for update window payload.', missingPayload: false },
  },
};

export const OrphanedWindow: Story = {
  args: {
    status: { kind: 'payload-error', message: 'No update payload was provided.', missingPayload: true },
  },
};
