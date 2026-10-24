import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('howler', async () => {
  const { createFakeSoundFactory } = await import('../../../services/audio/fakeSound');
  const { factory } = createFakeSoundFactory();
  return {
    Howl: class {
      constructor(options: Parameters<typeof factory>[0]) {
        return factory(options);
      }
    },
  };
});

import { MiniPlayer } from '@/components/common/MiniPlayer/MiniPlayer';
import { audioPlaybackService } from '@/services/audio/audioPlaybackService';

const first = { src: 'https://example.com/a.mp3', title: 'First episode', articleHash: 'hash-a' };
const second = { src: 'https://example.com/b.mp3', title: 'Second episode', articleHash: 'hash-b' };

describe('MiniPlayer', () => {
  afterEach(() => {
    cleanup();
    act(() => audioPlaybackService.clear());
  });

  it('stays hidden until something plays', () => {
    render(<MiniPlayer />);
    expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull();
  });

  it('shows the playing episode and steps aside while its article is open', () => {
    const { rerender } = render(<MiniPlayer hiddenForArticleHash="hash-a" />);
    act(() => audioPlaybackService.play(first));
    expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull();

    rerender(<MiniPlayer hiddenForArticleHash={null} />);
    expect(screen.getByRole('region', { name: 'Now playing' })).toBeTruthy();
    expect(screen.getByText('First episode')).toBeTruthy();
  });

  it('lists earlier episodes and switches to one from the queue', () => {
    render(<MiniPlayer />);
    act(() => {
      audioPlaybackService.play(first);
      audioPlaybackService.play(second);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.click(screen.getByRole('button', { name: /^First episode/ }));

    expect(audioPlaybackService.getSnapshot().currentId).toBe(first.src);
  });

  it('opens the episode article from the title', () => {
    const onOpenArticle = vi.fn();
    render(<MiniPlayer onOpenArticle={onOpenArticle} canOpenArticle={() => true} />);
    act(() => audioPlaybackService.play(first));

    fireEvent.click(screen.getByTitle('Open episode'));
    expect(onOpenArticle).toHaveBeenCalledWith('hash-a');
  });
});
