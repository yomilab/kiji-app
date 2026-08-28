import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SyncIndicator } from '@/components/Sidebar/SyncIndicator';

const syncIndicatorCss = () =>
  readFileSync(join(process.cwd(), 'src/components/Sidebar/SyncIndicator.css'), 'utf8');

describe('SyncIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders status text with the stable sync-indicator anchor', () => {
    render(<SyncIndicator text="Refreshing 3/12 feeds" />);

    const indicator = screen.getByText('Refreshing 3/12 feeds');
    expect(indicator.tagName).toBe('P');
    expect(indicator.getAttribute('data-component')).toBe('sync-indicator');
    expect(indicator.getAttribute('title')).toBe('Refreshing 3/12 feeds');
    expect(indicator.className).toContain('sync-indicator');
    expect(indicator.className).not.toContain('is-syncing');
  });

  it('applies the syncing class for the dots animation', () => {
    render(<SyncIndicator text="Syncing feeds" syncing />);

    expect(screen.getByText('Syncing feeds').className).toContain('is-syncing');
  });

  it('merges an extra className without dropping the base class', () => {
    render(<SyncIndicator text="Today 16:52" className="extra-slot" />);

    const indicator = screen.getByText('Today 16:52');
    expect(indicator.className).toContain('sync-indicator');
    expect(indicator.className).toContain('extra-slot');
  });

  it('ellipsizes left-aligned overflow instead of start-clipping with a mask', () => {
    const css = syncIndicatorCss();
    expect(css).toMatch(/text-align:\s*left/);
    expect(css).toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/text-overflow:\s*clip/);
    expect(css).not.toMatch(/mask-image/);
  });

  it('reserves end padding and absolutely positions syncing dots so ellipsis cannot clip them', () => {
    const css = syncIndicatorCss();
    expect(css).toMatch(/\.sync-indicator\.is-syncing\s*\{[^}]*padding-inline-end:\s*1\.25em/);
    expect(css).toMatch(/\.sync-indicator\.is-syncing::after\s*\{[^}]*position:\s*absolute/);
  });
});
