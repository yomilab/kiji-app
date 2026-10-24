import { Howl, type HowlOptions } from 'howler';

/**
 * App-wide audio playback. One sound plays at a time; every episode the user
 * starts joins a queue that outlives the article view, so closing an article
 * keeps the audio going and the mini player can switch between earlier
 * episodes. Inline players and the mini player are views over this state.
 */

export interface AudioTrack {
  /** Stable key; the audio URL. */
  id: string;
  src: string;
  title: string;
  subtitle?: string;
  artwork?: string;
  articleHash?: string;
  /** Seconds, from feed metadata, shown before the file loads. */
  durationHint?: number;
}

export type AudioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface AudioPlaybackSnapshot {
  queue: readonly AudioTrack[];
  currentId: string | null;
  status: AudioPlaybackStatus;
  /** Seconds into the current track. */
  position: number;
  /** Seconds; 0 when unknown. */
  duration: number;
  rate: number;
  muted: boolean;
  /** True when the current track could not be loaded or played. */
  failed: boolean;
}

export type AudioTrackInput = Omit<AudioTrack, 'id'> & { id?: string };

export interface AudioSound {
  play(): unknown;
  pause(): unknown;
  stop(): unknown;
  unload(): void;
  seek(position?: number): unknown;
  duration(): number;
  playing(): boolean;
  rate(rate?: number): unknown;
  mute(muted?: boolean): unknown;
}

export type AudioSoundFactory = (options: HowlOptions) => AudioSound;

export const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;
export const SKIP_BACK_SECONDS = 15;
export const SKIP_FORWARD_SECONDS = 30;
const POSITION_TICK_MS = 250;
/** Within this many seconds of the end counts as finished; resume starts over. */
const FINISHED_THRESHOLD_SECONDS = 2;
const MAX_QUEUE_LENGTH = 30;

type Listener = () => void;

const defaultSoundFactory: AudioSoundFactory = (options) => new Howl(options);

export class AudioPlaybackService {
  private snapshot: AudioPlaybackSnapshot = {
    queue: [],
    currentId: null,
    status: 'idle',
    position: 0,
    duration: 0,
    rate: 1,
    muted: false,
    failed: false,
  };
  private readonly listeners = new Set<Listener>();
  private readonly positions = new Map<string, number>();
  private readonly durations = new Map<string, number>();
  private sound: AudioSound | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly createSound: AudioSoundFactory = defaultSoundFactory) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AudioPlaybackSnapshot => this.snapshot;

  getCurrentTrack(): AudioTrack | null {
    const { queue, currentId } = this.snapshot;
    return queue.find((track) => track.id === currentId) ?? null;
  }

  /** Last known position for a track that is not necessarily playing. */
  getSavedPosition(id: string): number {
    if (id === this.snapshot.currentId) return this.snapshot.position;
    return this.positions.get(id) ?? 0;
  }

  getKnownDuration(id: string): number {
    if (id === this.snapshot.currentId && this.snapshot.duration > 0) return this.snapshot.duration;
    const track = this.snapshot.queue.find((item) => item.id === id);
    return this.durations.get(id) ?? track?.durationHint ?? 0;
  }

  /** Start (or resume) a track, adding it to the queue when new. */
  play(input: AudioTrackInput): void {
    const track = toTrack(input);
    this.upsert(track);
    if (track.id === this.snapshot.currentId && this.sound) {
      this.sound.play();
      return;
    }
    this.load(track.id, true);
  }

  /** Add a track to the end of the queue without interrupting playback. */
  enqueue(input: AudioTrackInput): void {
    this.upsert(toTrack(input));
  }

  isQueued(id: string): boolean {
    return this.snapshot.queue.some((track) => track.id === id);
  }

  toggle(): void {
    const { currentId, status } = this.snapshot;
    if (!currentId) return;
    if (status === 'playing' || status === 'loading') {
      this.pause();
      return;
    }
    if (!this.sound) {
      this.load(currentId, true);
      return;
    }
    this.sound.play();
  }

  pause(): void {
    if (!this.sound) return;
    this.sound.pause();
    // Howler reports pause asynchronously for html5 audio; reflect it now so
    // the button does not lag behind the click.
    this.stopTicking();
    this.update({ status: 'paused', position: this.readPosition() });
  }

  seek(seconds: number): void {
    const { currentId } = this.snapshot;
    if (!currentId) return;
    const duration = this.getKnownDuration(currentId);
    const target = clamp(seconds, 0, duration > 0 ? duration : Number.POSITIVE_INFINITY);
    this.positions.set(currentId, target);
    this.sound?.seek(target);
    this.update({ position: target });
  }

  skipBy(seconds: number): void {
    this.seek(this.snapshot.position + seconds);
  }

  /** Remember where a not-yet-playing track should start. */
  setSavedPosition(id: string, seconds: number): void {
    if (id === this.snapshot.currentId) {
      this.seek(seconds);
      return;
    }
    this.positions.set(id, Math.max(0, seconds));
    this.emit();
  }

  setRate(rate: number): void {
    this.sound?.rate(rate);
    this.update({ rate });
  }

  cycleRate(): void {
    const index = PLAYBACK_RATES.findIndex((rate) => rate === this.snapshot.rate);
    this.setRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]);
  }

  toggleMute(): void {
    const muted = !this.snapshot.muted;
    this.sound?.mute(muted);
    this.update({ muted });
  }

  playNext(): void {
    const next = this.neighbour(1);
    if (next) this.load(next.id, true);
  }

  playPrevious(): void {
    const previous = this.neighbour(-1);
    if (previous) this.load(previous.id, true);
  }

  remove(id: string): void {
    const { queue, currentId, status } = this.snapshot;
    if (!queue.some((track) => track.id === id)) return;
    this.positions.delete(id);
    if (id !== currentId) {
      this.update({ queue: queue.filter((track) => track.id !== id) });
      return;
    }
    const next = this.neighbour(1) ?? this.neighbour(-1);
    this.unloadSound();
    this.update({ queue: queue.filter((track) => track.id !== id) });
    if (next) {
      this.load(next.id, status === 'playing' || status === 'loading');
    } else {
      this.update({ currentId: null, status: 'idle', position: 0, duration: 0, failed: false });
    }
  }

  /** Stop playback and empty the queue. */
  clear(): void {
    this.unloadSound();
    this.positions.clear();
    this.update({ queue: [], currentId: null, status: 'idle', position: 0, duration: 0, failed: false });
    this.syncMediaSession();
  }

  private load(id: string, autoplay: boolean): void {
    const track = this.snapshot.queue.find((item) => item.id === id);
    if (!track) return;

    this.saveCurrentPosition();
    this.unloadSound();

    const knownDuration = this.durations.get(id) ?? track.durationHint ?? 0;
    let start = this.positions.get(id) ?? 0;
    if (knownDuration > 0 && start >= knownDuration - FINISHED_THRESHOLD_SECONDS) start = 0;

    const sound = this.createSound({
      src: [track.src],
      html5: true, // Stream long episodes instead of decoding them up front.
      rate: this.snapshot.rate,
      mute: this.snapshot.muted,
      onload: () => this.handleLoad(sound),
      onplay: () => this.handlePlay(sound),
      onpause: () => this.handlePause(sound),
      onstop: () => this.handlePause(sound),
      onend: () => this.handleEnd(sound),
      onloaderror: () => this.handleError(sound),
      onplayerror: () => this.handleError(sound),
    });
    this.sound = sound;
    if (start > 0) sound.seek(start);

    this.update({
      currentId: id,
      status: autoplay ? 'loading' : 'paused',
      position: start,
      duration: knownDuration,
      failed: false,
    });
    this.syncMediaSession();
    if (autoplay) sound.play();
  }

  private handleLoad(sound: AudioSound): void {
    if (sound !== this.sound) return;
    const duration = sound.duration() || 0;
    if (duration > 0 && this.snapshot.currentId) {
      this.durations.set(this.snapshot.currentId, duration);
    }
    this.update({ duration: duration || this.snapshot.duration });
  }

  private handlePlay(sound: AudioSound): void {
    if (sound !== this.sound) return;
    this.update({ status: 'playing', failed: false });
    this.startTicking();
    this.setMediaSessionState('playing');
  }

  private handlePause(sound: AudioSound): void {
    if (sound !== this.sound) return;
    this.stopTicking();
    this.update({ status: 'paused', position: this.readPosition() });
    this.setMediaSessionState('paused');
  }

  private handleEnd(sound: AudioSound): void {
    if (sound !== this.sound) return;
    const { currentId } = this.snapshot;
    if (currentId) this.positions.set(currentId, 0);
    this.stopTicking();
    const next = this.neighbour(1);
    if (next) {
      this.load(next.id, true);
      return;
    }
    this.update({ status: 'paused', position: 0 });
    this.setMediaSessionState('paused');
  }

  private handleError(sound: AudioSound): void {
    if (sound !== this.sound) return;
    this.stopTicking();
    this.update({ status: 'paused', failed: true });
  }

  private upsert(track: AudioTrack): void {
    const { queue } = this.snapshot;
    const index = queue.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      const merged = { ...queue[index], ...definedFields(track) };
      const nextQueue = queue.slice();
      nextQueue[index] = merged;
      this.update({ queue: nextQueue });
      return;
    }
    let nextQueue = [...queue, track];
    // Drop the oldest tracks that are not playing once the list grows long.
    while (nextQueue.length > MAX_QUEUE_LENGTH) {
      const dropIndex = nextQueue.findIndex((item) => item.id !== this.snapshot.currentId);
      this.positions.delete(nextQueue[dropIndex].id);
      nextQueue = nextQueue.filter((_, itemIndex) => itemIndex !== dropIndex);
    }
    this.update({ queue: nextQueue });
  }

  private neighbour(offset: 1 | -1): AudioTrack | null {
    const { queue, currentId } = this.snapshot;
    const index = queue.findIndex((track) => track.id === currentId);
    if (index < 0) return null;
    return queue[index + offset] ?? null;
  }

  private readPosition(): number {
    if (!this.sound) return this.snapshot.position;
    const value = this.sound.seek();
    return typeof value === 'number' && Number.isFinite(value) ? value : this.snapshot.position;
  }

  private saveCurrentPosition(): void {
    const { currentId } = this.snapshot;
    if (currentId && this.sound) this.positions.set(currentId, this.readPosition());
  }

  private unloadSound(): void {
    this.stopTicking();
    if (!this.sound) return;
    const sound = this.sound;
    this.sound = null;
    sound.unload();
  }

  private startTicking(): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => {
      if (!this.sound) return;
      this.update({ position: this.readPosition() });
    }, POSITION_TICK_MS);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private update(patch: Partial<AudioPlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Media keys and the macOS Now Playing widget, where the web view exposes them. */
  private syncMediaSession(): void {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    const track = this.getCurrentTrack();
    try {
      if (!track) {
        session.metadata = null;
        session.playbackState = 'none';
        return;
      }
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({
          title: track.title,
          artist: track.subtitle ?? '',
          artwork: track.artwork ? [{ src: track.artwork }] : [],
        });
      }
      session.setActionHandler('play', () => this.toggle());
      session.setActionHandler('pause', () => this.pause());
      session.setActionHandler('seekbackward', () => this.skipBy(-SKIP_BACK_SECONDS));
      session.setActionHandler('seekforward', () => this.skipBy(SKIP_FORWARD_SECONDS));
      session.setActionHandler('previoustrack', () => this.playPrevious());
      session.setActionHandler('nexttrack', () => this.playNext());
    } catch {
      // Some web views expose mediaSession without every action.
    }
  }

  private setMediaSessionState(state: MediaSessionPlaybackState): void {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (session) session.playbackState = state;
  }
}

function toTrack(input: AudioTrackInput): AudioTrack {
  return { ...input, id: input.id ?? input.src, title: input.title || fileNameFromUrl(input.src) };
}

function definedFields(track: AudioTrack): Partial<AudioTrack> {
  return Object.fromEntries(
    Object.entries(track).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<AudioTrack>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fileNameFromUrl(src: string): string {
  const path = src.split(/[?#]/)[0];
  const name = path.split('/').filter(Boolean).pop() ?? src;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** "4:05" or "1:02:09". */
export function formatPlaybackTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

export function formatPlaybackRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}×`;
}

export const audioPlaybackService = new AudioPlaybackService();
