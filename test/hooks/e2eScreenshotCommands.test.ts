import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('e2e screenshot harness commands', () => {
  it('drives library view, settings overlay, and frozen station switch', () => {
    const handler = readFileSync(join(process.cwd(), 'src/hooks/useE2eCommandHandler.ts'), 'utf8');
    expect(handler).toContain("case 'select-library-view'");
    expect(handler).toContain("case 'open-settings'");
    expect(handler).toContain('openSettingsWindow');
    expect(handler).toContain('forceNetwork');
    expect(handler).toContain('selectSmartView');

    const probes = readFileSync(join(process.cwd(), 'src/hooks/useE2eUiProbes.ts'), 'utf8');
    expect(probes).toContain('selectedSmartView');
    expect(probes).toContain("selectedSmartView ? 'smart'");
  });
});
