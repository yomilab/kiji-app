import {
  audioPlaybackService,
  fileNameFromUrl,
  formatPlaybackRate,
  formatPlaybackTime,
  SKIP_BACK_SECONDS,
  SKIP_FORWARD_SECONDS,
  type AudioTrackInput,
} from '@/services/audio/audioPlaybackService';
import { AUDIO_ICONS, iconSvg, skipIconSvg } from './audioIcons';

/**
 * Episode card inside an article. Playback lives in audioPlaybackService, so
 * removing this element (closing the article) does not stop the audio; the
 * mini player keeps control. Several cards for the same URL stay in sync.
 */
class FeedAudioPlayerElement extends HTMLElement {
  private root: ShadowRoot;
  private player!: HTMLElement;
  private artImage!: HTMLImageElement;
  private titleEl!: HTMLElement;
  private subtitleEl!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private backBtn!: HTMLButtonElement;
  private forwardBtn!: HTMLButtonElement;
  private rateBtn!: HTMLButtonElement;
  private queueBtn!: HTMLButtonElement;
  private progressRange!: HTMLInputElement;
  private elapsedEl!: HTMLElement;
  private remainingEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private isSeeking = false;

  static get observedAttributes() {
    return ['src', 'title', 'episode-title', 'subtitle', 'artwork', 'duration-hint'];
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.render();
    this.setupUI();
  }

  private render() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        margin: 1rem 0;
        container-type: inline-size;
        font-family: var(--ac-font-family, var(--font-family-ui, system-ui, sans-serif));
        --ap-accent: var(--theme-primary, var(--system-accent-color, var(--ac-accent-color, #3273dc)));
        --ap-text: var(--ac-text-primary, var(--theme-text-primary, #333));
        --ap-text-2: var(--ac-text-secondary, var(--theme-text-secondary, #666));
        --ap-surface: color-mix(in srgb, var(--theme-text-primary, #333) 4.5%, transparent);
        --ap-hover: color-mix(in srgb, var(--theme-text-primary, #333) 8%, transparent);
        --ap-border: color-mix(in srgb, var(--theme-border, rgba(127, 127, 127, 0.22)) 70%, transparent);
        --ap-track: color-mix(in srgb, var(--theme-text-primary, #333) 13%, transparent);
        --ap-progress: 0%;
      }

      .player {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas:
          "art info aside"
          "transport transport transport";
        column-gap: 14px;
        row-gap: 12px;
        align-items: center;
        padding: 14px 16px 12px;
        border-radius: 16px;
        border: 1px solid var(--ap-border);
        background:
          radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--ap-accent) 9%, transparent), transparent 60%),
          var(--ap-surface);
        color: var(--ap-text);
        box-sizing: border-box;
      }

      .art {
        grid-area: art;
        position: relative;
        width: 52px;
        height: 52px;
        border-radius: 11px;
        overflow: hidden;
        display: grid;
        place-items: center;
        color: var(--ap-accent);
        background: color-mix(in srgb, var(--ap-accent) 14%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-text-primary, #333) 8%, transparent);
      }

      .art img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .art img[hidden] { display: none; }
      .art > svg { width: 24px; height: 24px; fill: currentColor; }

      .info { grid-area: info; min-width: 0; }

      .title {
        font-size: 14px;
        font-weight: 650;
        line-height: 1.3;
        letter-spacing: -0.01em;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .subtitle {
        margin-top: 3px;
        font-size: 12px;
        color: var(--ap-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subtitle[data-empty="true"] { display: none; }

      .now-playing {
        display: none;
        margin-right: 6px;
        color: var(--ap-accent);
        font-weight: 600;
      }

      .player[data-current="true"] .now-playing { display: inline; }

      .aside { grid-area: aside; display: flex; gap: 4px; align-self: start; }

      .transport {
        grid-area: transport;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      button {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--ap-text);
        cursor: pointer;
        font: inherit;
        transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease, transform 0.12s ease;
      }

      button:hover:not(:disabled) { background: var(--ap-hover); }
      button:active:not(:disabled) { transform: scale(0.94); }
      button:disabled { opacity: 0.35; cursor: default; }
      button[hidden] { display: none; }

      button:focus-visible,
      input[type="range"]:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--ap-accent) 62%, transparent);
        outline-offset: 2px;
      }

      button svg { width: 22px; height: 22px; fill: currentColor; }

      .play {
        width: 40px;
        height: 40px;
        margin: 0 2px;
        color: #fff;
        background: var(--ap-accent);
        box-shadow: 0 4px 12px color-mix(in srgb, var(--ap-accent) 30%, transparent);
      }

      .play:hover:not(:disabled) { background: color-mix(in srgb, var(--ap-accent) 88%, #fff); }
      .play svg { width: 20px; height: 20px; }

      .player[data-status="loading"] .play svg { animation: ap-pulse 1s ease-in-out infinite; }

      @keyframes ap-pulse { 50% { opacity: 0.45; } }

      .rate {
        width: auto;
        min-width: 38px;
        height: 26px;
        padding: 0 8px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: var(--ap-text-2);
        box-shadow: inset 0 0 0 1px var(--ap-border);
      }

      .rate[data-active="true"] { color: var(--ap-accent); }
      .queue { width: 26px; height: 26px; color: var(--ap-text-2); }
      .queue svg { width: 18px; height: 18px; }
      .queue[aria-pressed="true"] { color: var(--ap-accent); }

      .scrub {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: 6px;
      }

      .time {
        flex: 0 0 auto;
        min-width: 38px;
        font-size: 11px;
        color: var(--ap-text-2);
        font-variant-numeric: tabular-nums;
      }

      .time.remaining { text-align: right; }

      input[type="range"] {
        flex: 1;
        min-width: 0;
        height: 4px;
        margin: 0;
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--ap-accent) 0 var(--ap-progress),
          var(--ap-track) var(--ap-progress) 100%
        );
        transition: height 0.12s ease;
      }

      input[type="range"]:hover:not(:disabled) { height: 6px; }
      input[type="range"]:disabled { cursor: default; opacity: 0.6; }

      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--ap-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ap-accent) 18%, transparent);
        opacity: 0;
        transition: opacity 0.12s ease;
      }

      .player[data-current="true"] input[type="range"]::-webkit-slider-thumb,
      input[type="range"]:hover::-webkit-slider-thumb,
      input[type="range"]:focus-visible::-webkit-slider-thumb { opacity: 1; }

      input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border: none;
        border-radius: 50%;
        background: var(--ap-accent);
      }

      .error {
        grid-column: 1 / -1;
        font-size: 12px;
        color: var(--theme-danger, #c0392b);
      }

      .error[hidden] { display: none; }

      @container (max-width: 380px) {
        .player { grid-template-areas: "art info aside" "transport transport transport"; }
        .transport { flex-wrap: wrap; justify-content: center; }
        .scrub { flex-basis: 100%; order: -1; margin: 0 0 4px; }
      }
    `;

    this.root.appendChild(style);

    const player = document.createElement('div');
    player.className = 'player';
    player.setAttribute('role', 'group');
    player.innerHTML = `
      <div class="art">
        ${iconSvg(AUDIO_ICONS.waveform)}
        <img alt="" hidden />
      </div>
      <div class="info">
        <div class="title"></div>
        <div class="subtitle-row subtitle"><span class="now-playing"></span><span class="subtitle-text"></span></div>
      </div>
      <div class="aside">
        <button class="rate" type="button" aria-label="Playback speed"></button>
        <button class="queue" type="button" aria-label="Play later" aria-pressed="false">${iconSvg(AUDIO_ICONS.playlistAdd)}</button>
      </div>
      <div class="transport">
        <button class="back" type="button" aria-label="Back ${SKIP_BACK_SECONDS} seconds">${skipIconSvg(SKIP_BACK_SECONDS, 'back')}</button>
        <button class="play" type="button" aria-label="Play">${iconSvg(AUDIO_ICONS.play)}</button>
        <button class="forward" type="button" aria-label="Forward ${SKIP_FORWARD_SECONDS} seconds">${skipIconSvg(SKIP_FORWARD_SECONDS, 'forward')}</button>
        <div class="scrub">
          <span class="time elapsed">0:00</span>
          <input type="range" class="progress" min="0" max="1000" value="0" step="1" aria-label="Seek" />
          <span class="time remaining">--:--</span>
        </div>
      </div>
      <div class="error" role="status" hidden>This episode couldn’t be played.</div>
    `;

    this.root.appendChild(player);
  }

  private setupUI() {
    const $ = <T extends Element>(selector: string) => this.root.querySelector(selector) as T;
    this.player = $('.player');
    this.artImage = $('.art img');
    this.titleEl = $('.title');
    this.subtitleEl = $('.subtitle-text');
    this.playBtn = $('.play');
    this.backBtn = $('.back');
    this.forwardBtn = $('.forward');
    this.rateBtn = $('.rate');
    this.queueBtn = $('.queue');
    this.progressRange = $('.progress');
    this.elapsedEl = $('.elapsed');
    this.remainingEl = $('.remaining');
    this.errorEl = $('.error');

    this.artImage.addEventListener('load', () => { this.artImage.hidden = false; });
    this.artImage.addEventListener('error', () => { this.artImage.hidden = true; });

    this.playBtn.addEventListener('click', () => {
      const track = this.track();
      if (!track) return;
      if (this.isCurrent()) {
        audioPlaybackService.toggle();
      } else {
        audioPlaybackService.play(track);
      }
    });
    this.backBtn.addEventListener('click', () => audioPlaybackService.skipBy(-SKIP_BACK_SECONDS));
    this.forwardBtn.addEventListener('click', () => audioPlaybackService.skipBy(SKIP_FORWARD_SECONDS));
    this.rateBtn.addEventListener('click', () => audioPlaybackService.cycleRate());
    this.queueBtn.addEventListener('click', () => {
      const track = this.track();
      if (!track) return;
      if (audioPlaybackService.isQueued(track.src)) {
        audioPlaybackService.remove(track.src);
      } else {
        audioPlaybackService.enqueue(track);
      }
    });

    this.progressRange.addEventListener('input', () => {
      this.isSeeking = true;
      const duration = this.duration();
      const position = (Number(this.progressRange.value) / 1000) * duration;
      this.paintProgress(position, duration);
    });

    this.progressRange.addEventListener('change', () => {
      const src = this.getAttribute('src');
      const duration = this.duration();
      this.isSeeking = false;
      if (!src || duration <= 0) return;
      audioPlaybackService.setSavedPosition(src, (Number(this.progressRange.value) / 1000) * duration);
    });
  }

  connectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = audioPlaybackService.subscribe(() => this.sync());
    this.sync();
  }

  disconnectedCallback() {
    // Leave playback running; the mini player takes over.
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  attributeChangedCallback() {
    this.syncMetadata();
    this.sync();
  }

  private track(): AudioTrackInput | null {
    const src = this.getAttribute('src');
    if (!src) return null;
    const durationHint = Number(this.getAttribute('duration-hint'));
    return {
      src,
      title: this.displayTitle(),
      subtitle: this.getAttribute('subtitle') || undefined,
      artwork: this.getAttribute('artwork') || undefined,
      articleHash: this.getAttribute('article-hash') || undefined,
      durationHint: Number.isFinite(durationHint) && durationHint > 0 ? durationHint : undefined,
    };
  }

  private displayTitle(): string {
    const src = this.getAttribute('src') || '';
    return this.getAttribute('episode-title') || this.getAttribute('title') || (src ? fileNameFromUrl(src) : '');
  }

  private isCurrent(): boolean {
    const src = this.getAttribute('src');
    return !!src && audioPlaybackService.getSnapshot().currentId === src;
  }

  private duration(): number {
    const src = this.getAttribute('src');
    if (!src) return 0;
    const known = audioPlaybackService.getKnownDuration(src);
    if (known > 0) return known;
    const hint = Number(this.getAttribute('duration-hint'));
    return Number.isFinite(hint) && hint > 0 ? hint : 0;
  }

  private syncMetadata() {
    if (!this.titleEl) return;
    const title = this.displayTitle();
    this.titleEl.textContent = title;
    this.player.setAttribute('aria-label', title ? `Episode audio: ${title}` : 'Episode audio');
    this.subtitleEl.textContent = this.getAttribute('subtitle') || '';
    const artwork = this.getAttribute('artwork');
    if (artwork) {
      if (this.artImage.getAttribute('src') !== artwork) {
        this.artImage.hidden = true;
        this.artImage.src = artwork;
      }
    } else {
      this.artImage.hidden = true;
      this.artImage.removeAttribute('src');
    }
  }

  private sync() {
    const src = this.getAttribute('src');
    const snapshot = audioPlaybackService.getSnapshot();
    const current = !!src && snapshot.currentId === src;
    const status = current ? snapshot.status : 'idle';
    const playing = status === 'playing' || status === 'loading';
    const duration = this.duration();
    const position = src ? audioPlaybackService.getSavedPosition(src) : 0;

    this.player.dataset.current = String(current);
    const subtitle = this.getAttribute('subtitle') || '';
    const subtitleRow = this.subtitleEl.parentElement!;
    subtitleRow.dataset.empty = String(!current && !subtitle);
    subtitleRow.querySelector('.now-playing')!.textContent = subtitle ? 'Now playing ·' : 'Now playing';
    this.player.dataset.status = status;

    this.playBtn.innerHTML = iconSvg(playing ? AUDIO_ICONS.pause : AUDIO_ICONS.play);
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : position > 0 ? 'Resume' : 'Play');
    this.playBtn.disabled = !src;
    this.backBtn.disabled = !current;
    this.forwardBtn.disabled = !current;
    this.progressRange.disabled = duration <= 0;

    this.rateBtn.textContent = formatPlaybackRate(snapshot.rate);
    this.rateBtn.dataset.active = String(snapshot.rate !== 1);

    // "Play later" only makes sense while something else is playing.
    const queued = !!src && audioPlaybackService.isQueued(src);
    this.queueBtn.hidden = current || !snapshot.currentId;
    this.queueBtn.setAttribute('aria-pressed', String(queued));
    this.queueBtn.setAttribute('aria-label', queued ? 'Remove from queue' : 'Play later');
    this.queueBtn.innerHTML = iconSvg(queued ? AUDIO_ICONS.playlistAdded : AUDIO_ICONS.playlistAdd);

    this.errorEl.hidden = !(current && snapshot.failed);

    if (!this.isSeeking) {
      this.progressRange.value = String(duration > 0 ? Math.round((position / duration) * 1000) : 0);
      this.paintProgress(position, duration);
    }
  }

  private paintProgress(position: number, duration: number) {
    const percent = duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0;
    this.progressRange.style.setProperty('--ap-progress', `${percent}%`);
    this.progressRange.setAttribute('aria-valuetext', `${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}`);
    this.elapsedEl.textContent = formatPlaybackTime(position);
    this.remainingEl.textContent = duration > 0 ? `-${formatPlaybackTime(duration - position)}` : '--:--';
  }
}

if (!customElements.get('feed-audio-player')) {
  customElements.define('feed-audio-player', FeedAudioPlayerElement);
}

export default FeedAudioPlayerElement;
