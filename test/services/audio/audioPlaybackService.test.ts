import { describe, expect, it } from 'vitest';
import {
  AudioPlaybackService,
  formatPlaybackTime,
} from '@/services/audio/audioPlaybackService';
import { createFakeSoundFactory } from './fakeSound';

const episode = (n: number) => ({ src: `https://example.com/ep${n}.mp3`, title: `Episode ${n}` });

describe('audioPlaybackService', () => {
  it('keeps every started episode in the queue and plays one at a time', () => {
    const { factory, sounds } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    service.play(episode(2));

    const snapshot = service.getSnapshot();
    expect(snapshot.queue.map((track) => track.title)).toEqual(['Episode 1', 'Episode 2']);
    expect(snapshot.currentId).toBe(episode(2).src);
    expect(snapshot.status).toBe('playing');
    expect(sounds[0].unloaded).toBe(true);
    expect(sounds[1].isPlaying).toBe(true);
  });

  it('resumes an earlier episode where it was left', () => {
    const { factory, sounds } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    sounds[0].position = 125;
    service.play(episode(2));
    service.play(episode(1));

    expect(sounds[2].position).toBe(125);
    expect(service.getSnapshot().position).toBe(125);
  });

  it('moves on to the next queued episode when one ends', () => {
    const { factory, sounds } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    service.enqueue(episode(2));
    sounds[0].fire('end');

    expect(service.getSnapshot().currentId).toBe(episode(2).src);
    expect(sounds[1].isPlaying).toBe(true);
  });

  it('enqueue does not interrupt the playing episode', () => {
    const { factory, sounds } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    service.enqueue(episode(2));

    expect(service.getSnapshot().currentId).toBe(episode(1).src);
    expect(sounds).toHaveLength(1);
    expect(service.isQueued(episode(2).src)).toBe(true);
  });

  it('removing the playing episode continues with the next one', () => {
    const { factory } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    service.enqueue(episode(2));
    service.remove(episode(1).src);

    const snapshot = service.getSnapshot();
    expect(snapshot.queue.map((track) => track.src)).toEqual([episode(2).src]);
    expect(snapshot.currentId).toBe(episode(2).src);
    expect(snapshot.status).toBe('playing');
  });

  it('skips within the episode bounds and cycles playback speed', () => {
    const { factory, sounds } = createFakeSoundFactory(100);
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    sounds[0].fire('load');
    service.skipBy(-15);
    expect(service.getSnapshot().position).toBe(0);
    service.skipBy(500);
    expect(service.getSnapshot().position).toBe(100);

    service.cycleRate();
    expect(service.getSnapshot().rate).toBe(1.25);
  });

  it('clear stops playback and empties the queue', () => {
    const { factory, sounds } = createFakeSoundFactory();
    const service = new AudioPlaybackService(factory);

    service.play(episode(1));
    service.clear();

    expect(sounds[0].unloaded).toBe(true);
    expect(service.getSnapshot()).toMatchObject({ queue: [], currentId: null, status: 'idle' });
  });

  it('formats long and short durations', () => {
    expect(formatPlaybackTime(65)).toBe('1:05');
    expect(formatPlaybackTime(3729)).toBe('1:02:09');
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
  });
});
