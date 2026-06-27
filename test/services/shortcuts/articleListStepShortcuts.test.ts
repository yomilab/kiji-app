import { describe, expect, it } from 'vitest';
import {
  isScrollDownShortcut,
  isScrollUpShortcut,
} from '@/services/shortcuts/shortcutService';

const keyEvent = (key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

describe('article list step shortcuts', () => {
  it('matches arrow keys and vim j/k', () => {
    expect(isScrollDownShortcut(keyEvent('ArrowDown'))).toBe(true);
    expect(isScrollUpShortcut(keyEvent('ArrowUp'))).toBe(true);
    expect(isScrollDownShortcut(keyEvent('j'))).toBe(true);
    expect(isScrollUpShortcut(keyEvent('k'))).toBe(true);
    expect(isScrollDownShortcut(keyEvent('J', { shiftKey: true }))).toBe(false);
    expect(isScrollUpShortcut(keyEvent('K', { shiftKey: true }))).toBe(false);
  });

  it('ignores j/k with modifiers', () => {
    expect(isScrollDownShortcut(keyEvent('j', { ctrlKey: true }))).toBe(false);
    expect(isScrollUpShortcut(keyEvent('k', { metaKey: true }))).toBe(false);
  });
});
