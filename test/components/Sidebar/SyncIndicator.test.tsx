import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SyncIndicator } from '@/components/Sidebar/SyncIndicator';

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
});
