import React from 'react';
import type { SmartViewId } from '@/constants';
import {
  AppearanceGlyph,
  BookGlyph,
  EnvelopeGlyph,
  FeedsGlyph,
  GearGlyph,
  PlusGlyph,
  RelaunchGlyph,
  SearchGlyph,
  SlidersGlyph,
  StationsGlyph,
  TrayArrowDownGlyph,
} from '@/components/SettingsWindow/settingsIcons';
import type { CommandPaletteActionId } from './commandPaletteModel';

/**
 * SF Symbols–style line glyphs for palette rows. Most reuse the Settings set;
 * the two library-only ones are drawn here on the same 24-unit grid.
 */
const LineGlyph: React.FC<{ name: string; children: React.ReactNode }> = ({ name, children }) => (
  <svg
    className="settings-glyph"
    data-glyph={name}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/** envelope.open */
export const EnvelopeOpenGlyph: React.FC = () => (
  <LineGlyph name="envelope.open">
    <path d="M3 10.2v7.8c0 1.3 1.1 2.4 2.4 2.4h13.2c1.3 0 2.4-1.1 2.4-2.4v-7.8" />
    <path d="M3 10.2 12 4l9 6.2" />
    <path d="m3.6 10.8 8.4 5.6 8.4-5.6" />
  </LineGlyph>
);

/** tray.full */
export const TrayFullGlyph: React.FC = () => (
  <LineGlyph name="tray.full">
    <path d="M3.6 13.2 6 5.8c.3-.9 1.1-1.4 2-1.4h8c.9 0 1.7.5 2 1.4l2.4 7.4v4.2c0 1.2-1 2.2-2.2 2.2H5.8c-1.2 0-2.2-1-2.2-2.2Z" />
    <path d="M3.6 13.2h4.6l1.2 2.2h5.2l1.2-2.2h4.6M8.4 7.6h7.2M7.8 10.4h8.4" />
  </LineGlyph>
);

/** sun.max */
export const SunGlyph: React.FC = () => (
  <LineGlyph name="sun.max">
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6" />
  </LineGlyph>
);

export const CommandPaletteSearchGlyph = SearchGlyph;

export const SMART_VIEW_GLYPHS: Record<SmartViewId, React.FC> = {
  saved: TrayArrowDownGlyph,
  unread: EnvelopeGlyph,
  today: SunGlyph,
  all: TrayFullGlyph,
  read: EnvelopeOpenGlyph,
};

export const ACTION_GLYPHS: Record<CommandPaletteActionId, React.FC> = {
  refresh: RelaunchGlyph,
  'add-feed': PlusGlyph,
  'manage-feeds': SlidersGlyph,
  settings: GearGlyph,
  'toggle-reader-mode': BookGlyph,
  'theme-auto': AppearanceGlyph,
  'theme-light': AppearanceGlyph,
  'theme-dark': AppearanceGlyph,
};

export const StationGlyph = StationsGlyph;
export const FeedFallbackGlyph = FeedsGlyph;
