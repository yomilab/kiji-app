import type { Meta, StoryObj } from '@storybook/react-vite';
import '@/components/common/AudioPlayer/FeedAudioPlayerElement';
import { audioPlaybackService } from '@/services/audio/audioPlaybackService';
import { MiniPlayer } from './MiniPlayer';

/** Silent WAV so the story plays without network audio. */
function silentWavDataUri(seconds: number): string {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const EPISODES = [
  { title: 'How small teams ship calm software', subtitle: 'The Changelog', seconds: 95 },
  { title: 'Reading in the age of feeds', subtitle: 'Hard Fork', seconds: 60 },
].map((episode) => ({ ...episode, src: silentWavDataUri(episode.seconds) }));

const meta = {
  title: 'Audio/Episode Player',
  component: MiniPlayer,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MiniPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardAndMiniPlayer: Story = {
  render: () => {
    audioPlaybackService.enqueue({ ...EPISODES[1], durationHint: EPISODES[1].seconds });
    return (
      <div className="theme-debug-backdrop" style={{ padding: 32, boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 640 }}>
          {EPISODES.map((episode) => (
            <feed-audio-player
              key={episode.title}
              src={episode.src}
              episode-title={episode.title}
              subtitle={episode.subtitle}
              duration-hint={String(episode.seconds)}
            />
          ))}
        </div>
        <MiniPlayer />
      </div>
    );
  },
};
