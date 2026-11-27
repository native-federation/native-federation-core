import type * as nodePath from 'path';
import { describe, expect, it, vi } from 'vitest';

// Mapped paths are built with path.join/normalize, so on Windows they carry backslashes. Running
// match-mapping against path.win32 reproduces that on any CI host.
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof nodePath>('path');
  return { ...actual.win32, default: actual.win32 };
});

const { isSharedMapping, matchMapping } = await import('./match-mapping.js');

describe('matchMapping on Windows paths', () => {
  it("matches a folder target's index file", () => {
    const mappings = { 'C:\\ws\\libs\\ui': '@org/ui' };

    expect(matchMapping('C:\\ws\\libs\\ui\\index.ts', mappings)).toBe('@org/ui');
    expect(isSharedMapping('C:\\ws\\libs\\ui\\index.ts', mappings)).toBe(true);
  });
});
