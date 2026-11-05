import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs release script without type declarations
import { buildUpdaterManifest } from '../../scripts/generate-updater-manifest.mjs';

const SUFFIXES = [
  'macos-aarch64.app.tar.gz',
  'macos-x86_64.app.tar.gz',
  'windows-x86_64-setup.exe',
  'windows-x86_64.msi',
  'windows-aarch64-setup.exe',
  'windows-aarch64.msi',
  'linux-x86_64.AppImage',
  'linux-aarch64.AppImage',
];

const signaturesFor = (version: string) =>
  Object.fromEntries(SUFFIXES.map((suffix) => [`Yomi-Reader-${version}-${suffix}`, `sig:${suffix}\n`]));

describe('buildUpdaterManifest', () => {
  const manifest = buildUpdaterManifest({
    version: '2.0.0',
    tag: 'v2.0.0',
    pubDate: '2026-11-08T00:00:00.000Z',
    signatures: signaturesFor('2.0.0'),
  });

  it('points each app at the installer type it was installed with', () => {
    expect(manifest.platforms['darwin-aarch64-app'].url).toBe(
      'https://github.com/yomilab/yomi-rss-reader/releases/download/v2.0.0/Yomi-Reader-2.0.0-macos-aarch64.app.tar.gz',
    );
    expect(manifest.platforms['windows-x86_64-nsis'].url).toContain('windows-x86_64-setup.exe');
    expect(manifest.platforms['windows-x86_64-msi'].url).toContain('windows-x86_64.msi');
    expect(manifest.platforms['linux-aarch64-appimage'].url).toContain('linux-aarch64.AppImage');
  });

  it('stores signature contents without the trailing newline', () => {
    expect(manifest.platforms['darwin-x86_64'].signature).toBe('sig:macos-x86_64.app.tar.gz');
  });

  it('leaves out deb and rpm, which need a password to install', () => {
    const targets = Object.keys(manifest.platforms);
    expect(targets.some((target) => /deb|rpm/.test(target))).toBe(false);
  });

  it('refuses to publish when a platform has no signature', () => {
    const signatures = signaturesFor('2.0.0');
    delete signatures['Yomi-Reader-2.0.0-windows-x86_64-setup.exe'];
    expect(() =>
      buildUpdaterManifest({ version: '2.0.0', tag: 'v2.0.0', pubDate: 'x', signatures }),
    ).toThrow(/windows-x86_64-setup\.exe/);
  });
});
