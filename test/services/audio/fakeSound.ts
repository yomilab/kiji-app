import type { HowlOptions } from 'howler';
import type { AudioSound, AudioSoundFactory } from '@/services/audio/audioPlaybackService';

export interface FakeSound extends AudioSound {
  options: HowlOptions;
  position: number;
  isPlaying: boolean;
  unloaded: boolean;
  fire(event: 'load' | 'play' | 'pause' | 'end' | 'loaderror'): void;
}

export function createFakeSoundFactory(durationSeconds = 600): { factory: AudioSoundFactory; sounds: FakeSound[] } {
  const sounds: FakeSound[] = [];
  const factory: AudioSoundFactory = (options) => {
    const sound: FakeSound = {
      options,
      position: 0,
      isPlaying: false,
      unloaded: false,
      play() { sound.isPlaying = true; sound.fire('play'); },
      pause() { sound.isPlaying = false; sound.fire('pause'); },
      stop() { sound.isPlaying = false; },
      unload() { sound.unloaded = true; sound.isPlaying = false; },
      seek(position?: number) {
        if (position === undefined) return sound.position;
        sound.position = position;
        return sound;
      },
      duration: () => durationSeconds,
      playing: () => sound.isPlaying,
      rate: () => sound,
      mute: () => sound,
      fire(event) {
        const handler = {
          load: options.onload,
          play: options.onplay,
          pause: options.onpause,
          end: options.onend,
          loaderror: options.onloaderror,
        }[event] as ((id: number, error?: unknown) => void) | undefined;
        handler?.(1, undefined);
      },
    };
    sounds.push(sound);
    return sound;
  };
  return { factory, sounds };
}
