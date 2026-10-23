import { describe, expect, it, vi, afterEach } from 'vitest';
import { mappingsFromWorkspace, pathsPackageOf, resolveMappingConfig } from './mapping-utils.js';
import { logger } from '../utils/logger.js';

const BASE = { singleton: true, strictVersion: true };

describe('mappingsFromWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The three equivalences agreed on issue #100 — the builder is sugar, nothing more.
  it('selects every mapping when no filter is given', () => {
    expect(mappingsFromWorkspace(BASE).get()).toEqual([[['*'], BASE]]);
  });

  it('narrows the selection to the filtered patterns', () => {
    expect(mappingsFromWorkspace(BASE).filter(['@org/ui/*']).get()).toEqual([
      [['@org/ui/*'], BASE],
    ]);
  });

  it('emits a patch ahead of the base selection, pre-merged over the base', () => {
    expect(mappingsFromWorkspace(BASE).patch(['@org/ui/*'], { singleton: false }).get()).toEqual([
      [['@org/ui/*'], { singleton: false, strictVersion: true }],
      [['*'], BASE],
    ]);
  });

  it('defaults the base config to an empty object', () => {
    expect(mappingsFromWorkspace().get()).toEqual([[['*'], {}]]);
  });

  it('unions repeated filter calls', () => {
    expect(mappingsFromWorkspace(BASE).filter(['@org/a']).filter(['@org/b']).get()).toEqual([
      [['@org/a', '@org/b'], BASE],
    ]);
  });

  it('keeps patches in declaration order', () => {
    const result = mappingsFromWorkspace(BASE)
      .patch(['@org/a'], { pool: 'first' })
      .patch(['@org/b'], { pool: 'second' })
      .get();

    expect(result.map(e => (e as [string[], object])[0])).toEqual([['@org/a'], ['@org/b'], ['*']]);
  });

  // A patch annotates the selection; it must not silently widen it.
  it('drops a patch that the filter does not cover, and warns', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = mappingsFromWorkspace(BASE)
      .filter(['@org/ui/*'])
      .patch(['@other/x'], { singleton: false })
      .get();

    expect(result).toEqual([[['@org/ui/*'], BASE]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@other/x'));
  });

  it('keeps a patch whose pattern falls under a wildcard filter', () => {
    const result = mappingsFromWorkspace(BASE)
      .filter(['@org/*'])
      .patch(['@org/ui/*'], { singleton: false })
      .get();

    expect(result).toEqual([
      [['@org/ui/*'], { singleton: false, strictVersion: true }],
      [['@org/*'], BASE],
    ]);
  });
});

describe('resolveMappingConfig', () => {
  const cfg = (pool: string) => ({ singleton: true, strictVersion: true, pool });

  // Falls back to the defaults rather than undefined, so callers never re-state them.
  it('returns the defaults when nothing matches', () => {
    expect(resolveMappingConfig('@org/ui', { '@other/*': cfg('a') }, true)).toEqual({
      singleton: true,
      strictVersion: true,
    });
  });

  it('tracks the mappingVersion flag in the fallback defaults', () => {
    expect(resolveMappingConfig('@org/ui', {}, false)).toEqual({
      singleton: true,
      strictVersion: false,
    });
  });

  it('matches an exact pattern', () => {
    expect(resolveMappingConfig('@org/ui', { '@org/ui': cfg('a') }, true)).toEqual(cfg('a'));
  });

  // The build sees resolved imports; the table is keyed by the pattern the user wrote.
  it('matches a resolved import against the wildcard pattern it came from', () => {
    expect(resolveMappingConfig('@org/ui/button', { '@org/ui/*': cfg('a') }, true)).toEqual(cfg('a'));
  });

  it("treats '*' as a catch-all", () => {
    expect(resolveMappingConfig('@anything/at/all', { '*': cfg('a') }, true)).toEqual(cfg('a'));
  });

  it('lets an exact pattern declared first beat a later wildcard', () => {
    const configs = { '@org/ui': cfg('exact'), '@org/*': cfg('wild') };
    expect(resolveMappingConfig('@org/ui', configs, true)).toEqual(cfg('exact'));
  });

  // Declaration order is the rule, not specificity — the builder relies on emitting patches first.
  it('lets a wildcard declared first beat a later exact pattern', () => {
    const configs = { '@org/*': cfg('wild'), '@org/ui': cfg('exact') };
    expect(resolveMappingConfig('@org/ui', configs, true)).toEqual(cfg('wild'));
  });
});

// Fixtures are tsconfig `paths` keys as workspaces write them (core#198).
describe('pathsPackageOf', () => {
  it.each([
    // [keys, import, package]
    [['@org/lib', '@org/lib/*'], '@org/lib', '@org/lib'],
    [['@org/lib', '@org/lib/*'], '@org/lib/testing', '@org/lib'],
    [['@org/lib/*'], '@org/lib/testing', '@org/lib'],
    // An explicit secondary key is its own package; whether it should join is a v5 question.
    [['@org/lib/*', '@org/lib/testing'], '@org/lib/testing', '@org/lib/testing'],
    [['@org/lib/*', '@org/lib/testing'], '@org/lib/other', '@org/lib'],
    // #176's layout: one key per library, deeper than the name rule.
    [['@shared/components/table'], '@shared/components/table', '@shared/components/table'],
    [['@shared/components/*'], '@shared/components/table', '@shared/components'],
    // A key coarser than the name rule leaves the name rule in charge.
    [['@shared/*'], '@shared/components/table', '@shared/components'],
    [['@a/*/index'], '@a/foo/index', '@a/foo'],
    [['@org/ui-*'], '@org/ui-table', '@org/ui-table'],
    [['@org/ui/x-*'], '@org/ui/x-table', '@org/ui'],
    [['*'], '@org/x/y', '@org/x'],
    [['libs/ui/*'], 'libs/ui/table', 'libs/ui'],
    // The longest prefix wins, in either key order.
    [['@org/*', '@org/ui/*'], '@org/ui/table/cell', '@org/ui'],
    [['@org/ui/*', '@org/*'], '@org/ui/table/cell', '@org/ui'],
    // No key matches: the name rule.
    [['@org/lib'], '@other/x/y', '@other/x'],
    [[], '@org/x/y', '@org/x'],
  ])('reads %j for %s as %s', (keys, importName, expected) => {
    expect(pathsPackageOf(importName, keys)).toBe(expected);
  });

  // `@a/b/c/index` starts with the prefix `@a/b/c/` and ends with the suffix `/index`, but only by
  // sharing their '/'; TypeScript does not resolve it through the key, so neither does the package.
  it('does not match a wildcard key whose prefix and suffix overlap', () => {
    expect(pathsPackageOf('@a/b/c/index', ['@a/b/c/*/index'])).toBe('@a/b');
  });
});
