import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectChangeFragments,
  groupChanges,
  insertVersionSection,
  parseChangeFragment,
  releaseChanges,
  suggestVersion,
  // @ts-expect-error -- plain .mjs release script without type declarations
} from '../../scripts/release-changes.mjs';
// @ts-expect-error -- plain .mjs release script without type declarations
import { extractReleaseNotes } from '../../scripts/release-notes.mjs';

const CHANGELOG = `# Changelog

<!-- New notes go in changes/. -->

## Unreleased

## [2.0.1] - 2026-11-06

### Fixed

- Wide images in articles keep their shape.
`;

const tempDirs: string[] = [];

function makeRepo(changelog: string, fragments: Record<string, string> = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-changes-'));
  tempDirs.push(rootDir);
  fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), changelog);
  fs.mkdirSync(path.join(rootDir, 'changes'));
  fs.writeFileSync(path.join(rootDir, 'changes', 'README.md'), '# Unreleased changes\n');
  for (const [file, text] of Object.entries(fragments)) {
    fs.writeFileSync(path.join(rootDir, 'changes', file), text);
  }
  return rootDir;
}

const fragment = (type: string, note: string) => `---\ntype: ${type}\n---\n${note}\n`;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('release-changes script', () => {
  it('parses a fragment with or without front-matter fences', () => {
    expect(parseChangeFragment(fragment('Fixed', 'Wide images keep their shape.'))).toEqual({
      heading: 'Fixed',
      note: 'Wide images keep their shape.',
    });
    expect(parseChangeFragment('type: added\n- A **Today** view\n  in the Library.\n')).toEqual({
      heading: 'Added',
      note: 'A **Today** view in the Library.',
    });
  });

  it('rejects a fragment with a missing or unknown type, or no note', () => {
    expect(() => parseChangeFragment('Just a note.\n', 'a.md')).toThrow('changes/a.md: missing "type');
    expect(() => parseChangeFragment(fragment('security', 'Note.'), 'b.md')).toThrow('unknown type "security"');
    expect(() => parseChangeFragment(fragment('fixed', ''), 'c.md')).toThrow('the note is empty');
    expect(() => parseChangeFragment('---\ntype: fixed\nNote.\n', 'd.md')).toThrow('no closing "---"');
  });

  it('collects fragments by file name and skips README.md and other files', () => {
    const rootDir = makeRepo(CHANGELOG, {
      'fix-b.md': fragment('fixed', 'Second fix.'),
      'feat-a.md': fragment('added', 'A new view.'),
      'notes.txt': 'not a fragment',
    });
    expect(collectChangeFragments(path.join(rootDir, 'changes'))).toEqual([
      { file: 'feat-a.md', heading: 'Added', note: 'A new view.' },
      { file: 'fix-b.md', heading: 'Fixed', note: 'Second fix.' },
    ]);
    expect(collectChangeFragments(path.join(rootDir, 'missing'))).toEqual([]);
  });

  it('groups changes in Added / Changed / Fixed order and drops empty groups', () => {
    expect(groupChanges([
      { heading: 'Fixed', note: 'Fix one.' },
      { heading: 'Added', note: 'New one.' },
      { heading: 'Fixed', note: 'Fix two.' },
    ])).toEqual([
      { heading: 'Added', items: ['New one.'] },
      { heading: 'Fixed', items: ['Fix one.', 'Fix two.'] },
    ]);
  });

  it('writes the version section below an empty Unreleased and deletes the fragments', () => {
    const rootDir = makeRepo(CHANGELOG, {
      'feat-circle-default-icon.md': fragment('changed', '**Circle** is now the default app icon.'),
      'fix-player.md': fragment('fixed', 'The player keeps its width.'),
      'feat-today.md': fragment('added', 'A new **Today** view.'),
    });

    const result = releaseChanges({ rootDir, version: '2.1.0', date: '2026-11-13', write: true });

    const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toBe(`# Changelog

<!-- New notes go in changes/. -->

## Unreleased

## [2.1.0] - 2026-11-13

### Added

- A new **Today** view.

### Changed

- **Circle** is now the default app icon.

### Fixed

- The player keeps its width.

## [2.0.1] - 2026-11-06

### Fixed

- Wide images in articles keep their shape.
`);
    expect(result.fragments).toEqual(['feat-circle-default-icon.md', 'feat-today.md', 'fix-player.md']);
    expect(fs.readdirSync(path.join(rootDir, 'changes'))).toEqual(['README.md']);
    // The CI tag gate and release.json read the written section like any other.
    expect(extractReleaseNotes(changelog, '2.1.0').sections).toEqual([
      { title: 'New', items: ['A new Today view.'] },
      { title: 'Improved', items: ['Circle is now the default app icon.'] },
      { title: 'Fixed', items: ['The player keeps its width.'] },
    ]);
    expect(extractReleaseNotes(changelog, 'Unreleased')).toBeNull();
  });

  it('includes lines a PR still added under Unreleased and leaves it empty', () => {
    const rootDir = makeRepo(
      CHANGELOG.replace('## Unreleased\n', '## Unreleased\n\n### Fixed\n\n- An older-style fix.\n'),
      { 'fix-new.md': fragment('fixed', 'A fragment fix.') },
    );

    const result = releaseChanges({ rootDir, version: '2.0.2', date: '2026-11-13', write: true });

    const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
    expect(result.leftovers).toBe(1);
    expect(changelog).toContain('## Unreleased\n\n## [2.0.2] - 2026-11-13\n\n### Fixed\n\n- An older-style fix.\n- A fragment fix.\n\n## [2.0.1]');
  });

  it('preview returns the draft without writing or deleting anything', () => {
    const rootDir = makeRepo(CHANGELOG, { 'fix-a.md': fragment('fixed', 'A fix.') });

    const { section } = releaseChanges({ rootDir, version: '2.0.2', date: '2026-11-13' });

    expect(section).toBe('## [2.0.2] - 2026-11-13\n\n### Fixed\n\n- A fix.\n');
    expect(fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
    expect(fs.readdirSync(path.join(rootDir, 'changes')).sort()).toEqual(['README.md', 'fix-a.md']);
  });

  it('does nothing when there are no fragments and Unreleased is empty', () => {
    const rootDir = makeRepo(CHANGELOG);

    const result = releaseChanges({ rootDir, version: '2.0.2', date: '2026-11-13', write: true });

    expect(result.section).toBeNull();
    expect(result.groups).toEqual([]);
    expect(fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
    expect(fs.readdirSync(path.join(rootDir, 'changes'))).toEqual(['README.md']);
  });

  it('refuses to write a version that is already in the changelog, and keeps the fragments', () => {
    const rootDir = makeRepo(CHANGELOG, { 'fix-a.md': fragment('fixed', 'A fix.') });

    expect(() => releaseChanges({ rootDir, version: '2.0.1', date: '2026-11-13', write: true }))
      .toThrow('already has a "## [2.0.1]" section');
    expect(fs.existsSync(path.join(rootDir, 'changes', 'fix-a.md'))).toBe(true);
  });

  it('adds an Unreleased heading when the changelog has none', () => {
    const changelog = insertVersionSection('# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old.\n', '## [1.0.1] - 2026-01-02\n\n### Fixed\n\n- New.\n');
    expect(changelog).toBe('# Changelog\n\n## Unreleased\n\n## [1.0.1] - 2026-01-02\n\n### Fixed\n\n- New.\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old.\n');
  });

  it('suggests a minor version for new features and a patch otherwise', () => {
    expect(suggestVersion('2.0.1', [{ heading: 'Added', items: ['x'] }, { heading: 'Fixed', items: ['y'] }])).toBe('2.1.0');
    expect(suggestVersion('2.0.1', [{ heading: 'Changed', items: ['x'] }])).toBe('2.0.2');
  });
});
