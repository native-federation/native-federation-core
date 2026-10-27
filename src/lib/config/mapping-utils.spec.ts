import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  declaredPackageOf,
  mappingPackageByImport,
  mappingsFromWorkspace,
  normalizeMappingConfig,
  resolveMappingConfig,
} from './mapping-utils.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
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

  // A declaration is not a selection, so filter() does not have to cover it: one shared module
  // can declare packages for remotes that select different libraries.
  it('emits package declarations ahead of patches and the selection', () => {
    const result = mappingsFromWorkspace(BASE)
      .filter(['@org/ui'])
      .patch(['@org/ui'], { pool: 'ui' })
      .package('@org/lib')
      .package('@org/data')
      .get();

    expect(result).toEqual([
      { ...BASE, package: '@org/lib' },
      { ...BASE, package: '@org/data' },
      [['@org/ui'], { ...BASE, pool: 'ui' }],
      [['@org/ui'], BASE],
    ]);
  });

  it('merges the package config over the base config', () => {
    expect(
      mappingsFromWorkspace(BASE).package('@org/lib', { pool: 'lib', chunks: false }).get()[0]
    ).toEqual({
      ...BASE,
      pool: 'lib',
      chunks: false,
      package: '@org/lib',
    });
  });

  // A declared package is always bundled as one, so a base build must not leak into it.
  it('leaves the base build out of a package', () => {
    const result = mappingsFromWorkspace({ ...BASE, build: 'separate' })
      .package('@org/lib')
      .get();

    expect(result[0]).toEqual({ ...BASE, package: '@org/lib' });
    expect(result[1]).toEqual([['*'], { ...BASE, build: 'separate' }]);
  });

  // The package's config applies to them, and a config here would contradict it.
  it('emits a selected pattern under a declared package without a config', () => {
    const result = mappingsFromWorkspace(BASE)
      .filter(['@org/lib/*', '@org/ui'])
      .package('@org/lib')
      .get();

    expect(result).toEqual([{ ...BASE, package: '@org/lib' }, '@org/lib/*', [['@org/ui'], BASE]]);
  });

  it('emits no base selection when every selected pattern is under a package', () => {
    const result = mappingsFromWorkspace(BASE).filter(['@org/lib']).package('@org/lib').get();

    expect(result).toEqual([{ ...BASE, package: '@org/lib' }, '@org/lib']);
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

// An absent chunks is what lets the planner fall back to the global value.
describe('normalizeMappingConfig', () => {
  it('keeps an explicit chunks and leaves an absent one out', () => {
    expect(normalizeMappingConfig({ chunks: false }, false)).toMatchObject({ chunks: false });
    expect(normalizeMappingConfig({}, false)).not.toHaveProperty('chunks');
  });
});

describe('resolveMappingConfig', () => {
  const cfg = (pool: string) => ({ singleton: true, strictVersion: true, pool });
  const resolve = (
    importName: string,
    sharedMappingsConfig: NormalizedFederationConfig['sharedMappingsConfig'],
    mappingVersion: boolean,
    sharedMappingPackages?: NormalizedFederationConfig['sharedMappingPackages']
  ) =>
    resolveMappingConfig(importName, {
      sharedMappingsConfig,
      sharedMappingPackages,
      features: { mappingVersion } as NormalizedFederationConfig['features'],
    });

  // Falls back to the defaults rather than undefined, so callers never re-state them.
  it('returns the defaults when nothing matches', () => {
    expect(resolve('@org/ui', { '@other/*': cfg('a') }, true)).toEqual({
      singleton: true,
      strictVersion: true,
    });
  });

  it('tracks the mappingVersion flag in the fallback defaults', () => {
    expect(resolve('@org/ui', {}, false)).toEqual({
      singleton: true,
      strictVersion: false,
    });
  });

  it('matches an exact pattern', () => {
    expect(resolve('@org/ui', { '@org/ui': cfg('a') }, true)).toEqual(cfg('a'));
  });

  // The build sees resolved imports; the table is keyed by the pattern the user wrote.
  it('matches a resolved import against the wildcard pattern it came from', () => {
    expect(resolve('@org/ui/button', { '@org/ui/*': cfg('a') }, true)).toEqual(cfg('a'));
  });

  it("treats '*' as a catch-all", () => {
    expect(resolve('@anything/at/all', { '*': cfg('a') }, true)).toEqual(cfg('a'));
  });

  it('lets an exact pattern declared first beat a later wildcard', () => {
    const configs = { '@org/ui': cfg('exact'), '@org/*': cfg('wild') };
    expect(resolve('@org/ui', configs, true)).toEqual(cfg('exact'));
  });

  // Declaration order is the rule, not specificity — the builder relies on emitting patches first.
  it('lets a wildcard declared first beat a later exact pattern', () => {
    const configs = { '@org/*': cfg('wild'), '@org/ui': cfg('exact') };
    expect(resolve('@org/ui', configs, true)).toEqual(cfg('wild'));
  });

  // One config per declared package holds by construction: it goes ahead of every pattern.
  it.each([['@org/lib'], ['@org/lib/testing'], ['@org/lib/a/b']])(
    'gives %s the config of its declared package, ahead of every pattern',
    importName => {
      const configs = { '*': cfg('base'), '@org/lib/testing': cfg('patch') };
      expect(resolve(importName, configs, true, { '@org/lib': cfg('pkg') })).toEqual(cfg('pkg'));
    }
  );

  it("leaves an import that only shares the prefix's characters to the patterns", () => {
    expect(resolve('@org/library', { '*': cfg('base') }, true, { '@org/lib': cfg('pkg') })).toEqual(
      cfg('base')
    );
  });

  it('gives an import the config of the longest declared package', () => {
    const packages = { '@org/lib': cfg('outer'), '@org/lib/testing': cfg('inner') };
    expect(resolve('@org/lib/testing/x', {}, true, packages)).toEqual(cfg('inner'));
    expect(resolve('@org/lib/other', {}, true, packages)).toEqual(cfg('outer'));
  });

  // A pattern outside the prefix keeps its own config; only the imports under the prefix take the
  // package's (AGENTS.md, mappingsFromWorkspace().package()).
  it('gives a wildcard outside a declared package only the imports outside it', () => {
    const packages = { '@org/ui': cfg('pkg') };
    expect(resolve('@org/uikit', { '@org/ui*': cfg('wild') }, true, packages)).toEqual(cfg('wild'));
    expect(resolve('@org/ui/button', { '@org/ui*': cfg('wild') }, true, packages)).toEqual(
      cfg('pkg')
    );
  });
});

describe('declaredPackageOf', () => {
  it.each([
    // [prefixes, import, package]
    [['@org/lib'], '@org/lib', '@org/lib'],
    [['@org/lib'], '@org/lib/testing', '@org/lib'],
    [['@org/lib'], '@org/lib/a/b', '@org/lib'],
    // '/'-aligned: a sibling that only shares the characters stays out.
    [['@org/lib'], '@org/library', undefined],
    // Finer than the name rule: #176's domain layout.
    [['@events/evaluation/core'], '@events/evaluation/core/x', '@events/evaluation/core'],
    [['@events/evaluation/core'], '@events/evaluation/other', undefined],
    // The longest declaration wins, in either order.
    [['@s/c', '@s/c/t'], '@s/c/t/sort', '@s/c/t'],
    [['@s/c/t', '@s/c'], '@s/c/t/sort', '@s/c/t'],
    [['@s/c', '@s/c/t'], '@s/c/u', '@s/c'],
    [[], '@org/lib', undefined],
  ])('reads %j for %s as %s', (prefixes, importName, expected) => {
    expect(declaredPackageOf(importName, prefixes)).toBe(expected);
  });
});

describe('mappingPackageByImport', () => {
  it('maps only the mappings under a declared package', () => {
    const config = {
      sharedMappings: {
        '/libs/lib/index.ts': '@org/lib',
        '/libs/lib/testing/index.ts': '@org/lib/testing',
        '/libs/library/index.ts': '@org/library',
      },
      sharedMappingPackages: { '@org/lib': BASE },
    } as unknown as NormalizedFederationConfig;

    expect(mappingPackageByImport(config)).toEqual(
      new Map([
        ['@org/lib', '@org/lib'],
        ['@org/lib/testing', '@org/lib'],
      ])
    );
  });
});
