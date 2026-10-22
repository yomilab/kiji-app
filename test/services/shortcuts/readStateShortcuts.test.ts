import { afterEach, describe, expect, it } from 'vitest';
import {
  isArticlePageDownShortcut,
  isArticlePageUpShortcut,
  isOpenNextUnreadShortcut,
  isToggleReadShortcut,
} from '@/services/shortcuts/shortcutService';

const keyEvent = (key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides }) as KeyboardEvent;

const openArticleLayer = () => {
  const container = document.createElement('div');
  container.className = 'app-container article-view-active';
  document.body.appendChild(container);
};

describe('read state shortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('m toggles read, but not with modifiers (⌘M minimizes)', () => {
    expect(isToggleReadShortcut(keyEvent('m'))).toBe(true);
    expect(isToggleReadShortcut(keyEvent('m', { metaKey: true }))).toBe(false);
    expect(isToggleReadShortcut(keyEvent('M', { shiftKey: true }))).toBe(false);
  });

  it('Space opens the next unread from the list only while no article is open', () => {
    expect(isOpenNextUnreadShortcut(keyEvent(' '))).toBe(true);
    expect(isArticlePageDownShortcut(keyEvent(' '))).toBe(false);
    openArticleLayer();
    expect(isOpenNextUnreadShortcut(keyEvent(' '))).toBe(false);
    expect(isArticlePageDownShortcut(keyEvent(' '))).toBe(true);
  });

  it('Shift+Space pages up in the article', () => {
    openArticleLayer();
    expect(isArticlePageUpShortcut(keyEvent(' ', { shiftKey: true }))).toBe(true);
    expect(isArticlePageDownShortcut(keyEvent(' ', { shiftKey: true }))).toBe(false);
  });

  it('modal dialogs swallow both keys', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    expect(isToggleReadShortcut(keyEvent('m'))).toBe(false);
    expect(isOpenNextUnreadShortcut(keyEvent(' '))).toBe(false);
  });
});
