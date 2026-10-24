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

import { audioPlaybackService } from '@/services/audio/audioPlaybackService';
import '@/components/common/AudioPlayer/FeedAudioPlayerElement';

const SRC = 'https://example.com/episode.mp3';

function mountPlayer(): HTMLElement {
  const player = document.createElement('feed-audio-player');
  player.setAttribute('src', SRC);
  player.setAttribute('episode-title', 'Episode One');
  player.setAttribute('subtitle', 'Example Show');
  document.body.appendChild(player);
  return player;
}

function playButton(player: HTMLElement): HTMLButtonElement {
  return player.shadowRoot!.querySelector('.play') as HTMLButtonElement;
}

describe('feed-audio-player', () => {
  afterEach(() => {
    audioPlaybackService.clear();
    document.body.innerHTML = '';
  });

  it('keeps playing after the article (and its player) is removed', () => {
    const player = mountPlayer();
    playButton(player).click();
    expect(audioPlaybackService.getSnapshot().currentId).toBe(SRC);

    const clearSpy = vi.spyOn(audioPlaybackService, 'clear');
    player.remove();

    expect(clearSpy).not.toHaveBeenCalled();
    expect(audioPlaybackService.getSnapshot().currentId).toBe(SRC);
    expect(audioPlaybackService.getSnapshot().queue[0]).toMatchObject({
      title: 'Episode One',
      subtitle: 'Example Show',
    });
  });

  it('a re-opened article reflects the episode that is already playing', () => {
    playButton(mountPlayer()).click();
    document.body.innerHTML = '';

    const reopened = mountPlayer();
    const root = reopened.shadowRoot!;
    expect((root.querySelector('.player') as HTMLElement).dataset.current).toBe('true');
    expect((root.querySelector('.back') as HTMLButtonElement).disabled).toBe(false);
  });
});
