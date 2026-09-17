import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SyncIndicator } from '@/components/Sidebar/SyncIndicator';

const syncIndicatorCss = () =>
  readFileSync(join(process.cwd(), 'src/components/Sidebar/SyncIndicator.css'), 'utf8');

const progressSlot = (root: ParentNode | null) =>
  root?.querySelector('[data-slot="sync-indicator-progress"]');

describe('SyncIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('paints a determinate ring and strips x/N from feed-sync copy', () => {
    render(<SyncIndicator text="Refreshing 3/12 feeds" />);

    const indicator = document.querySelector('[data-component="sync-indicator"]');
    expect(indicator?.tagName).toBe('P');
    expect(indicator?.getAttribute('title')).toBe('Refreshing feeds');
    expect(indicator?.className).toContain('sync-indicator');
    expect(indicator?.className).not.toContain('is-syncing');
    expect(screen.getByText('Refreshing feeds').className).toContain('sync-indicator-text');
    expect(screen.queryByText('Refreshing 3/12 feeds')).toBeNull();
    expect(indicator?.querySelector('[data-slot="sync-indicator-loader"]')).toBeNull();
    expect(indicator?.querySelector('animateTransform')).toBeNull();

    const ring = progressSlot(indicator);
    expect(ring).not.toBeNull();
    expect(indicator?.contains(ring)).toBe(true);
    expect(ring?.getAttribute('role')).toBe('progressbar');
    expect(ring?.getAttribute('aria-valuenow')).toBe('25');
    expect(ring?.getAttribute('aria-valuemin')).toBe('0');
    expect(ring?.getAttribute('aria-valuemax')).toBe('100');
    expect(ring?.getAttribute('aria-label')).toBe('Refreshing feeds');
    expect(ring?.querySelector('.sync-indicator-progress-track')).not.toBeNull();
    expect(ring?.querySelector('.sync-indicator-progress-arc')).not.toBeNull();
  });

  it('strips composed Syncing x/N {station} to Syncing {station}', () => {
    render(<SyncIndicator text="Syncing 3/50 Daily" />);

    expect(screen.getByText('Syncing Daily')).toBeTruthy();
    expect(screen.queryByText('Syncing 3/50 Daily')).toBeNull();
    expect(progressSlot(document)?.getAttribute('aria-valuenow')).toBe('6');
  });

  it('strips background Syncing x/N copy the same way', () => {
    render(<SyncIndicator text="Syncing 6/50 feeds" />);

    const ring = progressSlot(document);
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('aria-valuenow')).toBe('12');
    expect(screen.getByText('Syncing feeds')).toBeTruthy();
    expect(screen.queryByText('Syncing 6/50 feeds')).toBeNull();
  });

  it('shows a 0% track for overlay Clearing 0/N without painting the fraction', () => {
    render(<SyncIndicator text="Clearing 0/4 saved" />);

    const ring = progressSlot(document);
    expect(ring?.getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('Clearing saved')).toBeTruthy();
    expect(screen.queryByText(/0\/4/)).toBeNull();
  });

  it('keeps idle, hold, and count-only overlay copy text-only', () => {
    const { rerender } = render(<SyncIndicator text="Today 16:52" />);
    const indicator = () => document.querySelector('[data-component="sync-indicator"]');

    expect(progressSlot(indicator())).toBeNull();

    rerender(<SyncIndicator text="Syncing feeds" />);
    expect(progressSlot(indicator())).toBeNull();
    expect(screen.getByText('Syncing feeds')).toBeTruthy();

    rerender(<SyncIndicator text="Importing 42 feeds" />);
    expect(progressSlot(indicator())).toBeNull();
    expect(screen.getByText('Importing 42 feeds')).toBeTruthy();
  });

  it('reorganizes overlay Clearing and Exporting x/N copy', () => {
    const { rerender } = render(<SyncIndicator text="Clearing 3/10 articles" />);

    expect(progressSlot(document)?.getAttribute('aria-valuenow')).toBe('30');
    expect(screen.getByText('Clearing articles')).toBeTruthy();
    expect(screen.queryByText('Clearing 3/10 articles')).toBeNull();

    rerender(<SyncIndicator text="Exporting 3/10" />);
    expect(progressSlot(document)?.getAttribute('aria-valuenow')).toBe('30');
    expect(screen.getByText('Exporting')).toBeTruthy();
    expect(screen.queryByText('Exporting 3/10')).toBeNull();
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
    expect(css).toMatch(/\.sync-indicator\s*\{[^}]*padding-left:\s*var\(--sidebar-item-padding-x\)/);
    expect(css).toMatch(/\.sync-indicator\s*\{[^}]*gap:\s*8px/);
    expect(css).not.toMatch(/\.sync-indicator\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.sync-indicator-text\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.sync-indicator-text\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(
      /\.sync-indicator-progress\s*\{[^}]*flex:\s*0 0 var\(--sidebar-item-icon-size\)/,
    );
    expect(css).toMatch(/\.sync-indicator-progress-track/);
    expect(css).not.toMatch(/\.sync-indicator-loader/);
    expect(css).not.toMatch(/animateTransform/);
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
