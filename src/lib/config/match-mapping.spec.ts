import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { matchMapping, matchMappingEntry } from './match-mapping.js';

const ROOT = path.resolve('/ws');
const p = (...segs: string[]) => path.join(ROOT, ...segs);

const SOURCE_MAPPING = { [p('libs/ui/src/public-api.ts')]: '@org/ui' };
const PACKAGE_MAPPING = { [p('dist/ui')]: '@org/ui' };
const isPackage = (candidate: string) => candidate === p('dist/ui');

describe('matchMappingEntry — source mappings', () => {
  it('matches the barrel itself and reports the mapping path', () => {
    expect(matchMappingEntry(p('libs/ui/src/public-api.ts'), SOURCE_MAPPING)).toEqual({
      mappedPath: p('libs/ui/src/public-api.ts'),
      importName: '@org/ui',
    });
  });

  it('does not match an implementation file beside the barrel', () => {
    expect(matchMappingEntry(p('libs/ui/src/badge.component.ts'), SOURCE_MAPPING)).toBeNull();
  });

  it('matches an index file under a directory mapping', () => {
    const mapping = { [p('libs/ui/src')]: '@org/ui' };
    expect(matchMapping(p('libs/ui/src/index.ts'), mapping)).toBe('@org/ui');
  });

  // The mapped path becomes a bundler entry point downstream, so reporting the directory
  // here hands esbuild something it cannot load.
  it('reports the index file, not the directory, for a directory mapping', () => {
    const mapping = { [p('libs/ui/src')]: '@org/ui' };
    expect(matchMappingEntry(p('libs/ui/src/index.ts'), mapping)?.mappedPath).toBe(
      p('libs/ui/src/index.ts')
    );
  });

  // Without this, every file under a plain directory mapping would be advertised as the barrel.
  it('does not match a non-index file under a directory mapping', () => {
    const mapping = { [p('libs/ui/src')]: '@org/ui' };
    expect(matchMapping(p('libs/ui/src/badge.component.ts'), mapping)).toBeNull();
  });
});

describe('matchMappingEntry — package mappings', () => {
  // TypeScript resolves the package to its types, esbuild to its fesm bundle. Both have to
  // land on the same mapping, and both have to report the package directory as its identity.
  it.each([
    ['types entry (what TypeScript resolves)', 'types/ui.d.ts'],
    ['runtime entry (what esbuild resolves)', 'fesm2022/ui.mjs'],
  ])('matches the %s by containment', (_label, relative) => {
    expect(matchMappingEntry(p('dist/ui', relative), PACKAGE_MAPPING, { isPackage })).toEqual({
      mappedPath: p('dist/ui'),
      importName: '@org/ui',
    });
  });

  it('matches the package directory itself', () => {
    expect(matchMappingEntry(p('dist/ui'), PACKAGE_MAPPING, { isPackage })?.importName).toBe(
      '@org/ui'
    );
  });

  it('does not match a sibling directory sharing a name prefix', () => {
    expect(
      matchMappingEntry(p('dist/ui-extras/types/x.d.ts'), PACKAGE_MAPPING, { isPackage })
    ).toBeNull();
  });

  it('declines containment without the predicate, keeping pre-package behaviour', () => {
    expect(matchMappingEntry(p('dist/ui/types/ui.d.ts'), PACKAGE_MAPPING)).toBeNull();
  });

  it('does not widen a source mapping that the predicate rejects', () => {
    expect(
      matchMappingEntry(p('libs/ui/src/badge.component.ts'), SOURCE_MAPPING, { isPackage })
    ).toBeNull();
  });
});

describe('matchMappingEntry — wildcard mappings', () => {
  const WILDCARD = { [p('libs', '*', 'src')]: '@org/*' };

  it('reports the matched file as the mapped path, since each match is its own mapping', () => {
    expect(matchMappingEntry(p('libs/ui/src/index.ts'), WILDCARD)).toEqual({
      mappedPath: p('libs/ui/src/index.ts'),
      importName: '@org/ui',
    });
  });
});
