import { useSyncExternalStore } from 'react';
import {
  audioPlaybackService,
  type AudioPlaybackSnapshot,
} from '@/services/audio/audioPlaybackService';

export const useAudioPlayback = (): AudioPlaybackSnapshot => useSyncExternalStore(
  audioPlaybackService.subscribe,
  audioPlaybackService.getSnapshot,
  audioPlaybackService.getSnapshot,
);
