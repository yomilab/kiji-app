import { describe, expect, it } from 'vitest';

import {
  BLOCK_WIDE_CLASS,
  IMG_PENDING_CLASS,
  IMG_REVEAL_CLASS,
  LEAD_CLASS,
  MEDIA_BLEED_CLASS,
  MEDIA_GALLERY_CLASS,
  MEDIA_NATURAL_CLASS,
  MEDIA_PORTRAIT_CLASS,
  NATURAL_WIDTH_VAR,
  applyIntrinsicMediaSize,
  classifyStandaloneMedia,
  collectLightboxImages,
  findStandaloneMediaBlock,
  handleStandaloneMediaLoad,
} from '@/components/common/ArticleContent/standaloneMediaLayout';

function render(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function blockOf(container: Element): Element | null {
  const image = container.querySelector('img') as HTMLImageElement;
  return findStandaloneMediaBlock(container, image);
}

describe('findStandaloneMediaBlock', () => {
  it('accepts a top-level image and single-image wrappers', () => {
    expect(blockOf(render('<img src="a.jpg">'))?.tagName).toBe('IMG');
    expect(blockOf(render('<p><img src="a.jpg"></p>'))?.tagName).toBe('P');
    expect(blockOf(render('<p><a href="x"><img src="a.jpg"></a></p>'))?.tagName).toBe('P');
    expect(blockOf(render('<figure><picture><img src="a.jpg"></picture><figcaption>Caption</figcaption></figure>'))?.tagName).toBe('FIGURE');
  });

  it('rejects images that share their line with text', () => {
    expect(blockOf(render('<p>Hello <img src="a.jpg"> world</p>'))).toBeNull();
    expect(blockOf(render('<div><span>label</span><img src="a.jpg"></div>'))).toBeNull();
  });

  it('rejects images in nested reading contexts and multi-image blocks', () => {
    expect(blockOf(render('<blockquote><img src="a.jpg"></blockquote>'))).toBeNull();
    expect(blockOf(render('<ul><li><img src="a.jpg"></li></ul>'))).toBeNull();
    expect(blockOf(render('<table><tr><td><img src="a.jpg"></td></tr></table>'))).toBeNull();
    expect(blockOf(render('<p><img src="a.jpg"><img src="b.jpg"></p>'))).toBeNull();
  });
});

describe('classifyStandaloneMedia', () => {
  it('marks standalone blocks as bleed and leaves inline images alone', () => {
    const container = render('<p><img id="solo" src="a.jpg"></p><p>Text <img id="inline" src="b.jpg"></p>');
    classifyStandaloneMedia(container, 720);
    expect(container.querySelector('#solo')?.parentElement?.classList.contains(MEDIA_BLEED_CLASS)).toBe(true);
    expect(container.querySelector('#inline')?.parentElement?.className).toBe('');
  });

  it('keeps author-declared small images at natural size', () => {
    const container = render('<p><img src="icon.png" width="64" height="64"></p>');
    classifyStandaloneMedia(container, 720);
    const block = container.firstElementChild as HTMLElement;
    expect(block.classList.contains(MEDIA_BLEED_CLASS)).toBe(false);
    expect(block.classList.contains(MEDIA_NATURAL_CLASS)).toBe(true);
  });

  // WebKit lays out `sizes="auto"` images with no width/height attributes (the
  // sanitizer strips them) at the 150px fallback height: a 16:9 hero rendered 960x150.
  it('drops the auto keyword from sizes so images keep their aspect ratio', () => {
    const container = render(`
      <img id="hero" src="a.jpg" loading="lazy" srcset="a.jpg 768w, b.jpg 1600w" sizes="auto, (max-width: 768px) 100vw, 768px">
      <p>Text <img id="inline" src="b.jpg" sizes="AUTO, 100vw"></p>
      <img id="only" src="c.jpg" srcset="c.jpg 768w" sizes="auto">
      <picture><source id="source" srcset="d.webp 768w" sizes="auto, 50vw"><img id="fallback" src="d.jpg"></picture>
    `);
    classifyStandaloneMedia(container, 720);
    expect(container.querySelector('#hero')?.getAttribute('sizes')).toBe('(max-width: 768px) 100vw, 768px');
    expect(container.querySelector('#inline')?.getAttribute('sizes')).toBe('100vw');
    expect(container.querySelector('#only')?.hasAttribute('sizes')).toBe(false);
    expect(container.querySelector('#source')?.getAttribute('sizes')).toBe('50vw');
  });

  it('leaves sizes without the auto keyword untouched', () => {
    const sizes = '(max-width: 768px) 100vw, 768px';
    const container = render(`<img src="a.jpg" srcset="a.jpg 768w" sizes="${sizes}">`);
    classifyStandaloneMedia(container, 720);
    classifyStandaloneMedia(container, 720);
    expect(container.querySelector('img')?.getAttribute('sizes')).toBe(sizes);
  });
});

describe('applyIntrinsicMediaSize', () => {
  function bleedBlock(): HTMLElement {
    const block = document.createElement('figure');
    block.classList.add(MEDIA_BLEED_CLASS);
    return block;
  }

  it('keeps wide landscape images as bleed and records natural width', () => {
    const block = bleedBlock();
    applyIntrinsicMediaSize(block, 1600, 900, 720);
    expect(block.classList.contains(MEDIA_BLEED_CLASS)).toBe(true);
    expect(block.style.getPropertyValue(NATURAL_WIDTH_VAR)).toBe('1600px');
  });

  it('downgrades images under half the column to natural size', () => {
    const block = bleedBlock();
    applyIntrinsicMediaSize(block, 300, 200, 720);
    expect(block.classList.contains(MEDIA_BLEED_CLASS)).toBe(false);
    expect(block.classList.contains(MEDIA_NATURAL_CLASS)).toBe(true);
  });

  it('caps tall portrait images instead of widening them', () => {
    const block = bleedBlock();
    applyIntrinsicMediaSize(block, 800, 1400, 720);
    expect(block.classList.contains(MEDIA_BLEED_CLASS)).toBe(false);
    expect(block.classList.contains(MEDIA_PORTRAIT_CLASS)).toBe(true);
  });
});

describe('block classification', () => {
  const longText = 'A substantial opening paragraph that sets up the article and is long enough to be a lead.';

  it('marks image-only multi-image blocks as galleries', () => {
    const container = render('<p><img src="a.jpg"><img src="b.jpg"></p><figure><a href="x"><img src="c.jpg"></a><a href="y"><img src="d.jpg"></a><figcaption>Two</figcaption></figure>');
    classifyStandaloneMedia(container, 720);
    expect(container.children[0].classList.contains(MEDIA_GALLERY_CLASS)).toBe(true);
    expect(container.children[1].classList.contains(MEDIA_GALLERY_CLASS)).toBe(true);
  });

  it('does not treat images mixed with prose as a gallery', () => {
    const container = render('<p><img src="a.jpg"> and <img src="b.jpg"></p>');
    classifyStandaloneMedia(container, 720);
    expect(container.children[0].classList.contains(MEDIA_GALLERY_CLASS)).toBe(false);
  });

  it('bleeds standalone video and lite-youtube blocks', () => {
    const container = render('<video src="v.mp4"></video><figure><lite-youtube videoid="x"><button><span>Play</span></button></lite-youtube></figure><p>See <iframe src="e"></iframe></p>');
    classifyStandaloneMedia(container, 720);
    expect(container.children[0].classList.contains(MEDIA_BLEED_CLASS)).toBe(true);
    expect(container.children[1].classList.contains(MEDIA_BLEED_CLASS)).toBe(true);
    expect(container.children[2].classList.contains(MEDIA_BLEED_CLASS)).toBe(false);
  });

  it('marks top-level tables and code blocks as wide, not nested ones', () => {
    const container = render('<table><tr><td>1</td></tr></table><pre>code</pre><blockquote><pre>q</pre></blockquote>');
    classifyStandaloneMedia(container, 720);
    expect(container.children[0].classList.contains(BLOCK_WIDE_CLASS)).toBe(true);
    expect(container.children[1].classList.contains(BLOCK_WIDE_CLASS)).toBe(true);
    expect(container.querySelector('blockquote pre')?.classList.contains(BLOCK_WIDE_CLASS)).toBe(false);
  });

  it('marks the first substantial paragraph as the lead, once', () => {
    const container = render(`<p>Short.</p><p>${longText}</p><p>${longText}</p>`);
    classifyStandaloneMedia(container, 720);
    classifyStandaloneMedia(container, 720);
    expect(container.querySelectorAll(`.${LEAD_CLASS}`)).toHaveLength(1);
    expect(container.children[1].classList.contains(LEAD_CLASS)).toBe(true);
  });

  it('skips the lead when no early paragraph qualifies', () => {
    const container = render(`<h2>Heading</h2><p>Short.</p><div>x</div><p>${longText}</p>`);
    classifyStandaloneMedia(container, 720);
    expect(container.querySelector(`.${LEAD_CLASS}`)).toBeNull();
  });

  it('is idempotent and keeps a small-image downgrade on re-run', () => {
    const container = render('<p><img src="icon.png" width="64" height="64"></p>');
    classifyStandaloneMedia(container, 720);
    classifyStandaloneMedia(container, 720);
    expect(container.firstElementChild?.classList.contains(MEDIA_BLEED_CLASS)).toBe(false);
  });
});

describe('image loading state and lightbox set', () => {
  it('shows a placeholder until load, then reveals', () => {
    const container = render('<p><img src="a.jpg"></p>');
    classifyStandaloneMedia(container, 720);
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.classList.contains(IMG_PENDING_CLASS)).toBe(true);
    handleStandaloneMediaLoad(image, 720);
    expect(image.classList.contains(IMG_PENDING_CLASS)).toBe(false);
    expect(image.classList.contains(IMG_REVEAL_CLASS)).toBe(true);
  });

  it('collects laid-out, unlinked images in document order', () => {
    const container = render('<p><img id="a" src="a.jpg"></p><p>Inline <img id="b" src="b.jpg"></p><p><a href="x"><img id="c" src="c.jpg"></a></p><p><img id="d" src="d.jpg"><img id="e" src="e.jpg"></p><img id="f" src="f.jpg">');
    classifyStandaloneMedia(container, 720);
    expect(collectLightboxImages(container).map((image) => image.id)).toEqual(['a', 'd', 'e', 'f']);
  });
});
