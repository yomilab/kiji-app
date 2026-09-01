import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Feed e2e collection host', () => {
  it('keeps collection e2e hooks off the App fiber', () => {
    const appSrc = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).not.toMatch(/useE2eUiProbes/);
    expect(appSrc).not.toMatch(/useE2eCommandHandler/);
    expect(appSrc).not.toMatch(/useFeedCollection\(/);
  });

  it('hosts probes and commands under FeedProvider in the main renderer', () => {
    const rendererSrc = readFileSync(join(process.cwd(), 'src/renderer.tsx'), 'utf8');
    expect(rendererSrc).toMatch(/FeedE2eCollectionHost/);

    const hostSrc = readFileSync(join(process.cwd(), 'src/hooks/FeedE2eCollectionHost.tsx'), 'utf8');
    expect(hostSrc).toMatch(/useE2eUiProbes/);
    expect(hostSrc).toMatch(/useE2eCommandHandler/);
  });
});
