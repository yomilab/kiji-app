import { Howl } from 'howler';

const PLAY_ICON = 'M8 5v14l11-7z';
const PAUSE_ICON = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const VOLUME_UP_ICON = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
const VOLUME_OFF_ICON = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';

/**
 * Custom element for audio playback using Howler.js
 */
class FeedAudioPlayerElement extends HTMLElement {
  private root: ShadowRoot;
  private howl: Howl | null = null;
  private playBtn!: HTMLButtonElement;
  private progressRange!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private volumeBtn!: HTMLButtonElement;
  private animationId: number | null = null;
  private isSeeking = false;

  static get observedAttributes() {
    return ['src', 'title'];
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
        font-family: var(--ac-font-family, var(--font-family-ui, system-ui, sans-serif));
        --audio-player-accent: var(--theme-primary, var(--system-accent-color, var(--ac-accent-color, #3273dc)));
        --audio-player-accent-hover: var(--theme-primary-hover, color-mix(in srgb, var(--audio-player-accent) 82%, white));
        --audio-player-surface: color-mix(in srgb, var(--theme-article-bg, transparent) 82%, var(--theme-text-primary, #333) 6%);
        --audio-player-surface-elevated: color-mix(in srgb, var(--theme-article-bg, transparent) 72%, var(--theme-text-primary, #333) 10%);
        --audio-player-border: color-mix(in srgb, var(--theme-border, rgba(127, 127, 127, 0.22)) 72%, transparent);
        --audio-player-text-primary: var(--ac-text-primary, var(--theme-text-primary, #333));
        --audio-player-text-secondary: var(--ac-text-secondary, var(--theme-text-secondary, #666));
        --audio-player-track: color-mix(in srgb, var(--theme-text-primary, #333) 12%, transparent);
        --audio-player-shadow: color-mix(in srgb, var(--theme-shadow, rgba(0, 0, 0, 0.14)) 62%, transparent);
        --audio-player-progress: 0%;
      }

      .player-container {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--audio-player-accent) 10%, transparent), transparent 46%),
          var(--audio-player-surface);
        border: 1px solid var(--audio-player-border);
        border-radius: 18px;
        box-shadow: 0 10px 28px var(--audio-player-shadow);
        box-sizing: border-box;
        backdrop-filter: blur(18px) saturate(130%);
        -webkit-backdrop-filter: blur(18px) saturate(130%);
      }

      .controls-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      button {
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        background: color-mix(in srgb, var(--audio-player-surface-elevated) 88%, transparent);
        border: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--audio-player-text-primary);
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-border, rgba(127, 127, 127, 0.22)) 64%, transparent);
        transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
      }

      .play-pause-btn {
        width: 44px;
        height: 44px;
        color: white;
        background: linear-gradient(135deg, var(--audio-player-accent), var(--audio-player-accent-hover));
        box-shadow:
          0 8px 18px color-mix(in srgb, var(--audio-player-accent) 28%, transparent),
          inset 0 0 0 1px color-mix(in srgb, white 22%, transparent);
      }

      button:hover {
        background: color-mix(in srgb, var(--audio-player-accent) 13%, var(--audio-player-surface-elevated));
        transform: translateY(-1px);
      }

      .play-pause-btn:hover {
        background: linear-gradient(135deg, var(--audio-player-accent-hover), var(--audio-player-accent));
      }

      button:active {
        transform: translateY(0) scale(0.98);
      }

      button:focus-visible,
      input[type="range"]:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--audio-player-accent) 62%, transparent);
        outline-offset: 3px;
      }

      svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }

      .play-pause-btn svg {
        width: 26px;
        height: 26px;
      }

      .progress-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }

      .time-row {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--audio-player-text-secondary);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.01em;
      }

      input[type="range"] {
        width: 100%;
        height: 6px;
        margin: 0;
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--audio-player-accent) 0%,
          var(--audio-player-accent) var(--audio-player-progress),
          var(--audio-player-track) var(--audio-player-progress),
          var(--audio-player-track) 100%
        );
        accent-color: var(--audio-player-accent);
      }

      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border: 2px solid color-mix(in srgb, var(--theme-article-bg, white) 88%, white);
        border-radius: 50%;
        background: var(--audio-player-accent);
        box-shadow: 0 3px 10px color-mix(in srgb, var(--audio-player-accent) 34%, transparent);
      }

      input[type="range"]::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border: 2px solid color-mix(in srgb, var(--theme-article-bg, white) 88%, white);
        border-radius: 50%;
        background: var(--audio-player-accent);
        box-shadow: 0 3px 10px color-mix(in srgb, var(--audio-player-accent) 34%, transparent);
      }

      .title {
        font-size: 13px;
        font-weight: 650;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--audio-player-text-primary);
        letter-spacing: -0.01em;
      }
    `;

    this.root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'player-container';
    container.innerHTML = `
      <div class="title" id="title-display"></div>
      <div class="controls-row">
        <button class="play-pause-btn" aria-label="Play">
          <svg viewBox="0 0 24 24"><path d="${PLAY_ICON}" /></svg>
        </button>
        <div class="progress-container">
          <input type="range" class="progress-range" min="0" max="100" value="0" step="0.1">
          <div class="time-row">
            <span class="current-time">0:00</span>
            <span class="duration">0:00</span>
          </div>
        </div>
        <button class="volume-btn" aria-label="Mute">
          <svg viewBox="0 0 24 24"><path d="${VOLUME_UP_ICON}" /></svg>
        </button>
      </div>
    `;

    this.root.appendChild(container);
  }

  private setupUI() {
    this.playBtn = this.root.querySelector('.play-pause-btn')!;
    this.progressRange = this.root.querySelector('.progress-range')!;
    this.timeDisplay = this.root.querySelector('.current-time')!;
    this.volumeBtn = this.root.querySelector('.volume-btn')!;

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.volumeBtn.addEventListener('click', () => this.toggleMute());

    this.progressRange.addEventListener('input', () => {
      this.isSeeking = true;
      const percent = parseFloat(this.progressRange.value);
      this.setProgressVisual(percent);
      this.updateTimeDisplay(percent);
    });

    this.progressRange.addEventListener('change', () => {
      if (this.howl) {
        const percent = parseFloat(this.progressRange.value);
        this.howl.seek((percent / 100) * this.howl.duration());
      }
      this.isSeeking = false;
    });
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'src' && oldValue !== newValue) {
      this.loadAudio(newValue);
    }
    if (name === 'title') {
      const titleDisplay = this.root.getElementById('title-display');
      if (titleDisplay) titleDisplay.textContent = newValue;
    }
  }

  private loadAudio(src: string) {
    if (this.howl) {
      this.howl.unload();
    }

    this.howl = new Howl({
      src: [src],
      html5: true, // Prefer HTML5 for large audio files
      onplay: () => this.onPlay(),
      onpause: () => this.onPause(),
      onstop: () => this.onPause(),
      onend: () => this.onPause(),
      onload: () => this.onLoad(),
      onseek: () => {},
    });

    this.updateUI();
  }

  private togglePlay() {
    if (!this.howl) return;

    if (this.howl.playing()) {
      this.howl.pause();
    } else {
      this.howl.play();
    }
  }

  private toggleMute() {
    if (!this.howl) return;
    const muted = this.howl.mute();
    this.howl.mute(!muted);
    this.volumeBtn.querySelector('path')!.setAttribute('d', !muted ? VOLUME_OFF_ICON : VOLUME_UP_ICON);
  }

  private onPlay() {
    this.playBtn.querySelector('path')!.setAttribute('d', PAUSE_ICON);
    this.playBtn.setAttribute('aria-label', 'Pause');
    this.startProgressTimer();
  }

  private onPause() {
    this.playBtn.querySelector('path')!.setAttribute('d', PLAY_ICON);
    this.playBtn.setAttribute('aria-label', 'Play');
    this.stopProgressTimer();
  }

  private onLoad() {
    const duration = this.howl?.duration() || 0;
    this.root.querySelector('.duration')!.textContent = this.formatTime(duration);
  }

  private startProgressTimer() {
    const step = () => {
      if (!this.isSeeking) {
        this.updateProgress();
      }
      this.animationId = requestAnimationFrame(step);
    };
    this.animationId = requestAnimationFrame(step);
  }

  private stopProgressTimer() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private updateProgress() {
    if (!this.howl || !this.howl.playing()) return;

    const seek = this.howl.seek() as number || 0;
    const duration = this.howl.duration() || 0;
    const percent = (seek / duration) * 100 || 0;

    this.progressRange.value = percent.toString();
    this.setProgressVisual(percent);
    this.updateTimeDisplay(percent);
  }

  private setProgressVisual(percent: number) {
    const clampedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    this.progressRange.style.setProperty('--audio-player-progress', `${clampedPercent}%`);
  }

  private updateTimeDisplay(percent: number) {
    if (!this.howl) return;
    const duration = this.howl.duration() || 0;
    const current = (percent / 100) * duration;
    this.timeDisplay.textContent = this.formatTime(current);
  }

  private formatTime(secs: number): string {
    const minutes = Math.floor(secs / 60) || 0;
    const seconds = Math.floor(secs - minutes * 60) || 0;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  private updateUI() {
    this.playBtn.querySelector('path')!.setAttribute('d', PLAY_ICON);
    this.progressRange.value = '0';
    this.setProgressVisual(0);
    this.timeDisplay.textContent = '0:00';
    const title = this.getAttribute('title') || this.getAttribute('src')?.split('/').pop() || '';
    const titleDisplay = this.root.getElementById('title-display');
    if (titleDisplay) titleDisplay.textContent = title;
  }

  disconnectedCallback() {
    if (this.howl) {
      this.howl.unload();
    }
    this.stopProgressTimer();
  }
}

if (!customElements.get('feed-audio-player')) {
  customElements.define('feed-audio-player', FeedAudioPlayerElement);
}

export default FeedAudioPlayerElement;
