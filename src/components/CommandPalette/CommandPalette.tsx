import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaviconImage } from '@/components/common/FaviconImage';
import { shortcutKeyGroups } from '@/components/SettingsWindow/settingsControls';
import {
  applySidebarFavicons,
  hydrateSidebarFavicons,
  needsSidebarFavicon,
  type SidebarFaviconEntry,
} from '@/services/favicons/sidebarFaviconCache';
import { keybindingService } from '@/services/shortcuts/shortcutService';
import {
  ACTION_GLYPHS,
  CommandPaletteSearchGlyph,
  FeedFallbackGlyph,
  SMART_VIEW_GLYPHS,
  StationGlyph,
} from './commandPaletteIcons';
import {
  rankCommandPaletteEntries,
  type CommandPaletteEntry,
  type CommandPaletteFeed,
} from './commandPaletteModel';
import './CommandPalette.css';

const FAVICON_HYDRATE_DELAY_MS = 120;
const LISTBOX_ID = 'command-palette-results';

export interface CommandPaletteProps {
  entries: readonly CommandPaletteEntry[];
  recentKeys: readonly string[];
  onPick: (entry: CommandPaletteEntry) => void;
  onClose: () => void;
  initialQuery?: string;
}

const optionId = (index: number): string => `command-palette-option-${index}`;

const shortcutHint = (shortcut: string): string =>
  shortcutKeyGroups(shortcut)
    .map((keys) => (keys.every((key) => key.length === 1) ? keys.join('') : keys.join('+')))
    .join(' / ');

const entrySubtitle = (entry: CommandPaletteEntry): string | null => {
  switch (entry.kind) {
    case 'smart':
      return 'Library';
    case 'station':
      return 'Station';
    case 'feed':
      return entry.stationLabel;
    case 'action':
      return entry.shortcut ? shortcutHint(entry.shortcut) : null;
    default:
      return null;
  }
};

const EntryIcon: React.FC<{ entry: CommandPaletteEntry; feed?: CommandPaletteFeed }> = ({ entry, feed }) => {
  if (entry.kind === 'feed') {
    const shown = feed ?? entry.feed;
    return (
      <FaviconImage
        localFavicon={shown.favicon}
        hasTransparency={shown.faviconHasTransparency}
        emoji={shown.emoji}
        alt=""
        itemId={shown.id}
        fallbackIcon={<FeedFallbackGlyph />}
      />
    );
  }
  if (entry.kind !== 'action' && entry.emoji) {
    return <span className="command-palette-emoji">{entry.emoji}</span>;
  }
  if (entry.kind === 'smart') {
    const Glyph = SMART_VIEW_GLYPHS[entry.viewId];
    return <Glyph />;
  }
  if (entry.kind === 'station') {
    return <StationGlyph />;
  }
  const Glyph = ACTION_GLYPHS[entry.actionId];
  return <Glyph />;
};

/**
 * Spotlight-style quick switcher. Mounted only while open, so query and
 * selection start fresh each time. While mounted it owns the keyboard: every
 * keydown stops at the window so list, article, and app shortcuts stay quiet
 * (text still reaches the field; only propagation is stopped).
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  entries,
  recentKeys,
  onPick,
  onClose,
  initialQuery = '',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hydratedFavicons, setHydratedFavicons] = useState<ReadonlyMap<string, SidebarFaviconEntry>>(
    () => new Map(),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => rankCommandPaletteEntries(entries, query, recentKeys),
    [entries, query, recentKeys],
  );

  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`#${optionId(activeIndex)}`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => keybindingService.register({
    type: 'keydown',
    capture: true,
    priority: 2000,
    handler: (event: KeyboardEvent) => {
      // Nothing behind the palette may react while it is open.
      event.stopPropagation();
      if (event.isComposing) return;

      const isPrimary = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape' || (isPrimary && !event.shiftKey && (key === 'k' || key === 'w'))) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      const count = resultsRef.current.length;
      if (event.key === 'ArrowDown' || (event.ctrlKey && key === 'n')) {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(count - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp' || (event.ctrlKey && key === 'p')) {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = resultsRef.current[activeIndexRef.current];
        if (entry) onPickRef.current(entry);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
      }
    },
  }), []);

  // Slim catalog rows carry no favicon blob; fill the painted feed rows from the
  // shared sidebar favicon cache once typing pauses.
  useEffect(() => {
    const pending = results.filter(
      (entry): entry is Extract<CommandPaletteEntry, { kind: 'feed' }> => (
        entry.kind === 'feed' && needsSidebarFavicon(entry.feed) && !hydratedFavicons.has(entry.feed.id)
      ),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void hydrateSidebarFavicons(pending.map((entry) => entry.feed)).then((hydrated) => {
        if (cancelled || hydrated.size === 0) return;
        setHydratedFavicons((current) => {
          const next = new Map(current);
          for (const [id, favicon] of hydrated) next.set(id, favicon);
          return next;
        });
      }).catch(() => {});
    }, FAVICON_HYDRATE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hydratedFavicons, results]);

  const activeEntry = results[activeIndex];

  return createPortal(
    <div
      className="command-palette-backdrop"
      data-component="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        data-component="command-palette"
      >
        <div className="command-palette-search">
          <span className="command-palette-search-icon" aria-hidden="true">
            <CommandPaletteSearchGlyph />
          </span>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            role="combobox"
            aria-label="Go to a feed, station, or action"
            aria-expanded={results.length > 0}
            aria-controls={results.length > 0 ? LISTBOX_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeEntry ? optionId(activeIndex) : undefined}
            placeholder="Go to a feed, station, or action"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            data-component="command-palette-input"
          />
        </div>
        {results.length > 0 ? (
          <ul
            ref={listRef}
            id={LISTBOX_ID}
            className="command-palette-results"
            role="listbox"
            aria-label="Results"
          >
            {results.map((entry, index) => {
              const subtitle = entrySubtitle(entry);
              const hydrated = entry.kind === 'feed' ? hydratedFavicons.get(entry.feed.id) : undefined;
              const feed = entry.kind === 'feed' && hydrated
                ? applySidebarFavicons([entry.feed], new Map([[entry.feed.id, hydrated]]))[0]
                : undefined;
              return (
                <li
                  key={entry.key}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`command-palette-row${index === activeIndex ? ' is-active' : ''}`}
                  data-component="command-palette-row"
                  data-entry-key={entry.key}
                  onMouseMove={() => {
                    if (activeIndexRef.current !== index) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(entry)}
                >
                  <span className="command-palette-row-icon">
                    <EntryIcon entry={entry} feed={feed} />
                  </span>
                  <span className="command-palette-row-title">{entry.title}</span>
                  {subtitle && <span className="command-palette-row-subtitle">{subtitle}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="command-palette-empty" data-component="command-palette-empty" aria-hidden="true">No matches</div>
        )}
        <span className="visually-hidden" role="status">
          {results.length === 0
            ? 'No matches'
            : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
        </span>
      </div>
    </div>,
    document.body,
  );
};
