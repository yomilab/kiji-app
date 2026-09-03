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

    const indicator = document.querySelector('[data-component="sync-indicator"]');
    expect(indicator?.tagName).toBe('P');
    expect(indicator?.getAttribute('title')).toBe('Refreshing 3/12 feeds');
    expect(indicator?.className).toContain('sync-indicator');
    expect(indicator?.className).not.toContain('is-syncing');
    expect(screen.getByText('Refreshing 3/12 feeds').className).toContain('sync-indicator-text');
    expect(indicator?.querySelector('[data-slot="sync-indicator-loader"]')).toBeNull();
  });

  it('merges an extra className without dropping the base class', () => {
    render(<SyncIndicator text="Today 16:52" className="extra-slot" />);

    const indicator = document.querySelector('[data-component="sync-indicator"]');
    expect(indicator?.className).toContain('sync-indicator');
    expect(indicator?.className).toContain('extra-slot');
  });

  it('ellipsizes the inner text span, not the host, so Settings squeeze can clip copy', () => {
    const css = syncIndicatorCss();
    expect(css).toMatch(/text-align:\s*left/);
    expect(css).toMatch(/\.sync-indicator\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.sync-indicator-text\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.sync-indicator-text\s*\{[^}]*min-width:\s*0/);
    expect(css).not.toMatch(/\.sync-indicator-loader/);
    expect(css).not.toMatch(/text-overflow:\s*clip/);
    expect(css).not.toMatch(/mask-image/);
  });

  it('does not reserve trailing syncing dots', () => {
    const css = syncIndicatorCss();
    expect(css).not.toMatch(/::after/);
    expect(css).not.toMatch(/padding-inline-end:\s*1\.25em/);
    expect(css).not.toMatch(/@keyframes\s+syncDots/);
  });
});
