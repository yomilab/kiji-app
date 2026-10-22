import { describe, expect, it } from 'vitest';
import {
  captureReadingAnchor,
  findReadingAnchorElement,
  restoreReadingAnchor,
} from '@/components/common/ArticleContent/readingAnchor';

const setRect = (element: Element, rect: () => { top: number; height: number }) => {
  element.getBoundingClientRect = () => {
    const { top, height } = rect();
    return { top, bottom: top + height, height, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
};

describe('readingAnchor', () => {
  it('finds the deepest text block crossing the viewport top', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p id="a">one</p><section id="s"><p id="b">two</p><p id="c">three</p></section>';
    setRect(container.querySelector('#a')!, () => ({ top: 0, height: 50 }));
    setRect(container.querySelector('#s')!, () => ({ top: 50, height: 200 }));
    setRect(container.querySelector('#b')!, () => ({ top: 50, height: 100 }));
    setRect(container.querySelector('#c')!, () => ({ top: 150, height: 100 }));
    expect(findReadingAnchorElement(container, 160)?.id).toBe('c');
    expect(findReadingAnchorElement(container, 10)?.id).toBe('a');
    expect(findReadingAnchorElement(container, 400)).toBeNull();
  });

  it('scrolls so the same spot of the anchor block stays at the top after a reflow', () => {
    const scroll = document.createElement('div');
    scroll.scrollTop = 300;
    setRect(scroll, () => ({ top: 52, height: 600 }));
    const paragraph = document.createElement('p');
    scroll.appendChild(paragraph);
    document.body.appendChild(scroll);
    let scale = 1;
    // Block sits at 400px (content coordinates) and grows with the text.
    setRect(paragraph, () => ({ top: 52 + 400 * scale - scroll.scrollTop, height: 100 * scale }));

    scroll.scrollTop = 420; // 20px into the paragraph
    const anchor = captureReadingAnchor(scroll, () => paragraph);
    expect(anchor?.fraction).toBeCloseTo(0.2);

    scale = 1.4;
    restoreReadingAnchor(scroll, anchor);
    // 400*1.4 + 0.2*140 = 588
    expect(scroll.scrollTop).toBeCloseTo(588);
    scroll.remove();
  });

  it('does nothing at the top of the article', () => {
    const scroll = document.createElement('div');
    scroll.scrollTop = 0;
    expect(captureReadingAnchor(scroll, () => document.createElement('p'))).toBeNull();
  });
});
