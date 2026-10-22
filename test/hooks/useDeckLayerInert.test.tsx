import { afterEach, describe, expect, it } from 'vitest';
import React, { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import { useDeckLayerInert } from '@/hooks/useDeckLayerInert';

const Deck: React.FC<{ phase: ArticleViewOverlayPhase; isDeckOpen: boolean }> = ({ phase, isDeckOpen }) => {
  const sidebar = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  useDeckLayerInert({ libraryLayerRefs: [sidebar, main], articleLayerRef: article, overlayPhase: phase, isDeckOpen });
  return (
    <>
      <div ref={sidebar} data-testid="sidebar" />
      <div ref={main} data-testid="main" />
      <div ref={article} data-testid="article" />
    </>
  );
};

const inertState = (container: HTMLElement) => ['sidebar', 'main', 'article'].map(
  (id) => container.querySelector(`[data-testid="${id}"]`)!.hasAttribute('inert'),
);

afterEach(cleanup);

describe('useDeckLayerInert', () => {
  it('hides the off-screen reader, then the covered sidebar and list, from Tab and VoiceOver', () => {
    const { container, rerender } = render(<Deck phase="closed" isDeckOpen={false} />);
    expect(inertState(container)).toEqual([false, false, true]);

    rerender(<Deck phase="opening" isDeckOpen />);
    expect(inertState(container)).toEqual([true, true, false]);

    rerender(<Deck phase="open" isDeckOpen />);
    expect(inertState(container)).toEqual([true, true, false]);

    // Closing: the list is live again so focus can go back to the row.
    rerender(<Deck phase="closing" isDeckOpen={false} />);
    expect(inertState(container)).toEqual([false, false, false]);

    rerender(<Deck phase="closed" isDeckOpen={false} />);
    expect(inertState(container)).toEqual([false, false, true]);
  });
});
