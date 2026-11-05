import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs release script without type declarations
import { extractReleaseNotes, renderReleaseNotesMarkdown, toManifestNotes } from '../../scripts/release-notes.mjs';

const CHANGELOG = `# Changelog

## Unreleased

### Fixed

- Not released yet.

## [1.6.0] - 2026-10-20

A faster, calmer reader.

### Fixed

- Feeds in **Japanese** no longer fail.
  Continued on a wrapped line.

### Added

- Reader themes in \`Settings → Appearance\`.
- [Linked](https://example.com) item.

### Changed

- Background refresh keeps every slot busy.

## [1.5.0] - 2026-10-16

### Fixed

- Older fix.
`;

describe('release-notes script', () => {
  it('extracts one version as grouped plain-text notes in New / Improved / Fixed order', () => {
    const notes = extractReleaseNotes(CHANGELOG, '1.6.0');
    expect(toManifestNotes(notes)).toEqual({
      summary: 'A faster, calmer reader.',
      sections: [
        { title: 'New', items: ['Reader themes in Settings → Appearance.', 'Linked item.'] },
        { title: 'Improved', items: ['Background refresh keeps every slot busy.'] },
        { title: 'Fixed', items: ['Feeds in Japanese no longer fail. Continued on a wrapped line.'] },
      ],
    });
  });

  it('accepts a leading v and stops at the next version', () => {
    expect(toManifestNotes(extractReleaseNotes(CHANGELOG, 'v1.5.0'))).toEqual({
      sections: [{ title: 'Fixed', items: ['Older fix.'] }],
    });
  });

  it('returns null when the version has no section', () => {
    expect(extractReleaseNotes(CHANGELOG, '1.7.0')).toBeNull();
    expect(extractReleaseNotes(CHANGELOG, '1.6')).toBeNull();
  });

  it('renders the GitHub body with the original Markdown and site links', () => {
    const markdown = renderReleaseNotesMarkdown(extractReleaseNotes(CHANGELOG, '1.6.0'), {
      websiteUrl: 'https://reader.yomilab.app',
      version: '1.6.0',
    });
    expect(markdown).toContain('### New\n\n- Reader themes in `Settings → Appearance`.');
    expect(markdown).toContain('- Feeds in **Japanese** no longer fail. Continued on a wrapped line.');
    expect(markdown).toContain('https://reader.yomilab.app/changelog/#v1.6.0');
    expect(markdown.indexOf('### New')).toBeLessThan(markdown.indexOf('### Fixed'));
  });

  it('localizes group titles and nests translations in the manifest notes', () => {
    const zh = extractReleaseNotes(`## [1.6.0] - 2026-10-20

### Fixed

- 修复了一个问题。

### Added

- 新的 **阅读主题**。
`, '1.6.0', { locale: 'zh-Hans' });
    expect(toManifestNotes(extractReleaseNotes(CHANGELOG, '1.6.0'), { 'zh-Hans': zh, ja: null }).translations).toEqual({
      'zh-Hans': {
        sections: [
          { title: '新功能', items: ['新的 阅读主题。'] },
          { title: '修复', items: ['修复了一个问题。'] },
        ],
      },
    });
  });
});
