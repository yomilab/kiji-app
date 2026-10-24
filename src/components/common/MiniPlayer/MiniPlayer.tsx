import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import './MiniPlayer.css';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';
import {
  audioPlaybackService,
  formatPlaybackRate,
  formatPlaybackTime,
  SKIP_BACK_SECONDS,
  SKIP_FORWARD_SECONDS,
  type AudioTrack,
} from '@/services/audio/audioPlaybackService';
import { AUDIO_ICONS, skipIconSvg } from '@/components/common/AudioPlayer/audioIcons';

interface MiniPlayerProps {
  /** The episode card for this article is on screen, so the pill steps aside. */
  hiddenForArticleHash?: string | null;
  /** Opens the episode's article; returns false when it is not reachable. */
  onOpenArticle?: (articleHash: string) => void;
  canOpenArticle?: (articleHash: string) => boolean;
}

const Icon: React.FC<{ path: string }> = ({ path }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
);

const SkipIcon: React.FC<{ seconds: number; direction: 'back' | 'forward' }> = ({ seconds, direction }) => (
  <span className="mini-player-skip-icon" dangerouslySetInnerHTML={{ __html: skipIconSvg(seconds, direction) }} />
);

const Artwork: React.FC<{ track: AudioTrack; size: 'pill' | 'row' }> = ({ track, size }) => {
  const [failed, setFailed] = useState(false);
  useDependencyEffect(() => setFailed(false), [track.artwork]);
  return (
    <span className={`mini-player-art mini-player-art-${size}`} aria-hidden="true">
      {track.artwork && !failed
        ? <img src={track.artwork} alt="" onError={() => setFailed(true)} />
        : <Icon path={AUDIO_ICONS.waveform} />}
    </span>
  );
};

function describeTrack(track: AudioTrack, isCurrent: boolean, position: number, duration: number): string {
  const parts: string[] = [];
  if (track.subtitle) parts.push(track.subtitle);
  if (duration > 0) {
    const left = Math.max(0, duration - position);
    if (isCurrent || position > 0) {
      parts.push(left < 1 ? 'Played' : `${formatPlaybackTime(left)} left`);
    } else {
      parts.push(formatPlaybackTime(duration));
    }
  }
  return parts.join(' · ');
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  hiddenForArticleHash = null,
  onOpenArticle,
  canOpenArticle,
}) => {
  const playback = useAudioPlayback();
  const [queueOpen, setQueueOpen] = useState(false);

  const current = playback.queue.find((track) => track.id === playback.currentId) ?? null;
  const visible = !!current && !(current.articleHash && current.articleHash === hiddenForArticleHash);

  useDependencyEffect(() => {
    if (!queueOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.mini-player')) setQueueOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [queueOpen]);

  useDependencyEffect(() => {
    if (!visible) setQueueOpen(false);
  }, [visible]);

  const isPlaying = playback.status === 'playing' || playback.status === 'loading';
  const progress = playback.duration > 0 ? Math.min(100, (playback.position / playback.duration) * 100) : 0;
  const articleHash = current?.articleHash;
  const titleOpensArticle = !!articleHash && !!onOpenArticle && (canOpenArticle?.(articleHash) ?? true);

  return (
    <AnimatePresence>
      {visible && current && (
        <motion.div
          key="mini-player"
          className="mini-player"
          role="region"
          aria-label="Now playing"
          data-component="mini-player"
          data-status={playback.status}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: 'tween', duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <AnimatePresence>
            {queueOpen && (
              <motion.div
                key="queue"
                className="mini-player-queue"
                role="dialog"
                aria-label="Listening queue"
                data-component="mini-player-queue"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ type: 'tween', duration: 0.14 }}
              >
                <div className="mini-player-queue-header">
                  <span>Queue</span>
                  <button type="button" className="mini-player-text-button" onClick={() => audioPlaybackService.clear()}>
                    Clear all
                  </button>
                </div>
                <ul className="mini-player-queue-list">
                  {playback.queue.map((track) => {
                    const isCurrent = track.id === playback.currentId;
                    const position = audioPlaybackService.getSavedPosition(track.id);
                    const duration = audioPlaybackService.getKnownDuration(track.id);
                    return (
                      <li key={track.id} className={`mini-player-queue-row ${isCurrent ? 'is-current' : ''}`}>
                        <button
                          type="button"
                          className="mini-player-queue-play"
                          aria-current={isCurrent ? 'true' : undefined}
                          onClick={() => (isCurrent ? audioPlaybackService.toggle() : audioPlaybackService.play(track))}
                        >
                          <Artwork track={track} size="row" />
                          <span className="mini-player-queue-text">
                            <span className="mini-player-queue-title">{track.title}</span>
                            <span className="mini-player-queue-meta">
                              {isCurrent && <span className="mini-player-live">{isPlaying ? 'Playing' : 'Paused'}</span>}
                              {describeTrack(track, isCurrent, position, duration)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mini-player-icon-button mini-player-queue-remove"
                          aria-label={`Remove ${track.title} from queue`}
                          onClick={() => audioPlaybackService.remove(track.id)}
                        >
                          <Icon path={AUDIO_ICONS.close} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mini-player-pill">
            <Artwork track={current} size="pill" />
            <button
              type="button"
              className="mini-player-text"
              disabled={!titleOpensArticle}
              onClick={() => articleHash && onOpenArticle?.(articleHash)}
              title={titleOpensArticle ? 'Open episode' : undefined}
            >
              <span className="mini-player-title">{current.title}</span>
              <span className="mini-player-meta">
                {playback.failed
                  ? 'Couldn’t play this episode'
                  : describeTrack(current, true, playback.position, playback.duration)}
              </span>
            </button>
            <div className="mini-player-controls">
              <button
                type="button"
                className="mini-player-icon-button"
                aria-label={`Back ${SKIP_BACK_SECONDS} seconds`}
                onClick={() => audioPlaybackService.skipBy(-SKIP_BACK_SECONDS)}
              >
                <SkipIcon seconds={SKIP_BACK_SECONDS} direction="back" />
              </button>
              <button
                type="button"
                className="mini-player-icon-button mini-player-play"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={() => audioPlaybackService.toggle()}
                data-component="mini-player-toggle"
              >
                <Icon path={isPlaying ? AUDIO_ICONS.pause : AUDIO_ICONS.play} />
              </button>
              <button
                type="button"
                className="mini-player-icon-button"
                aria-label={`Forward ${SKIP_FORWARD_SECONDS} seconds`}
                onClick={() => audioPlaybackService.skipBy(SKIP_FORWARD_SECONDS)}
              >
                <SkipIcon seconds={SKIP_FORWARD_SECONDS} direction="forward" />
              </button>
              <span className="mini-player-divider" aria-hidden="true" />
              <button
                type="button"
                className="mini-player-rate"
                aria-label="Playback speed"
                onClick={() => audioPlaybackService.cycleRate()}
              >
                {formatPlaybackRate(playback.rate)}
              </button>
              <button
                type="button"
                className={`mini-player-icon-button mini-player-queue-toggle ${queueOpen ? 'is-active' : ''}`}
                aria-label="Queue"
                aria-expanded={queueOpen}
                onClick={() => setQueueOpen((open) => !open)}
              >
                <Icon path={AUDIO_ICONS.queue} />
                {playback.queue.length > 1 && (
                  <span className="mini-player-badge">{playback.queue.length}</span>
                )}
              </button>
              <button
                type="button"
                className="mini-player-icon-button"
                aria-label="Stop and close player"
                onClick={() => audioPlaybackService.clear()}
              >
                <Icon path={AUDIO_ICONS.close} />
              </button>
            </div>
            <span className="mini-player-progress" aria-hidden="true" style={{ width: `${progress}%` }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
