import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('sidebar stylesheet imports', () => {
  it('keeps row stylesheets wired so Library, stations, and feeds do not paint unstyled', () => {
    expect(readSource('src/components/Sidebar/SmartViews.tsx')).toContain("import './SmartViews.css'");
    expect(readSource('src/components/Sidebar/TagManager.tsx')).toContain("import './TagManager.css'");
    expect(readSource('src/components/Sidebar/FeedList.tsx')).toContain("import './FeedList.css'");
  });
});
