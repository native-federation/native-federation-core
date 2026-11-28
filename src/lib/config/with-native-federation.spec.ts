import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// with-native-federation reaches the filesystem through share/project-paths and
// mapped-paths; stub those so the normalization logic can be tested in isolation.
const shareAll = vi.fn();
const findMappingsTsConfig = vi.fn();
const getRawMappedPaths = vi.fn();

vi.mock('./share-utils.js', () => ({
  fromPackageJson: (...args: unknown[]) => ({ get: () => shareAll(...args) }),
}));

vi.mock('./project-paths.js', () => ({
  findMappingsTsConfig: (...args: unknown[]) => findMappingsTsConfig(...args),
}));

vi.mock('./mapped-paths.js', () => ({
  // Only the specs that declare packages set them.
  getRawMappedPaths: (...args: unknown[]) => ({
    packages: {},
    keys: [],
    patterns: [],
    ...getRawMappedPaths(...args),
  }),
}));

import { withNativeFederation } from './with-native-federation.js';
import { logger } from '../utils/logger.js';
import type { FederationConfig } from '../domain/config/federation-config.contract.js';
import type { ExternalConfig } from '../domain/config/external-config.contract.js';

describe('withNativeFederation', () => {
  beforeEach(() => {
    shareAll.mockReturnValue({});
    findMappingsTsConfig.mockReturnValue('/ws/tsconfig.json');
    getRawMappedPaths.mockReturnValue({ paths: {}, configs: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('applies defaults for an empty config', () => {
    const result = withNativeFederation({});

    expect(result).toMatchObject({
      $type: 'classic',
      name: '',
      exposes: {},
      shared: {},
      sharedMappings: {},
      sharedMappingsConfig: {},
      chunks: true,
      externals: [],
      features: {
        mappingVersion: true,
        ignoreUnusedDeps: true,
        denseChunking: true,
        denseExternals: true,
        integrityHashes: false,
      },
    });
  });

  it('falls back to shareAll when no shared config is provided', () => {
    shareAll.mockReturnValue({ react: { singleton: true } });

    const result = withNativeFederation({});

    expect(shareAll).toHaveBeenCalled();
    expect(result.shared['react']).toMatchObject({ singleton: true });
  });

  it('does not call shareAll when shared is explicitly configured', () => {
    withNativeFederation({ shared: { react: { singleton: true } } });
    expect(shareAll).not.toHaveBeenCalled();
  });

  // Lets a config pass fromPackageJson(...) / mappingsFromWorkspace(...) without calling .get().
  it('resolves a builder passed as shared', () => {
    const result = withNativeFederation({
      shared: { get: () => ({ react: { singleton: true } }) },
    });

    expect(shareAll).not.toHaveBeenCalled();
    expect(Object.keys(result.shared)).toEqual(['react']);
    expect(result.shared['react']).toMatchObject({ singleton: true });
  });

  // `get` is a legal package name; only a function marks a builder.
  it('treats a shared package named "get" as a package, not a builder', () => {
    const result = withNativeFederation({ shared: { get: { singleton: true } } });

    expect(Object.keys(result.shared)).toEqual(['get']);
  });

  it('resolves a builder passed as sharedMappings', () => {
    withNativeFederation({ sharedMappings: { get: () => [[['@org/*'], { singleton: true }]] } });

    expect(getRawMappedPaths).toHaveBeenCalledWith('/ws/tsconfig.json', [
      [['@org/*'], { singleton: true }],
    ]);
  });

  it('normalizes string exposes into { file } entries and passes objects through', () => {
    const result = withNativeFederation({
      exposes: {
        './Cmp': './src/cmp.ts',
        './Other': { file: './src/other.ts', element: 'x-other' },
      },
    });

    expect(result.exposes).toEqual({
      './Cmp': { file: './src/cmp.ts' },
      './Other': { file: './src/other.ts', element: 'x-other' },
    });
  });

  it('normalizes shared externals with sensible defaults', () => {
    const result = withNativeFederation({ shared: { react: {} } });

    expect(result.shared['react']).toEqual({
      requiredVersion: 'auto',
      singleton: false,
      strictVersion: false,
      version: undefined,
      includeSecondaries: undefined,
      packageInfo: undefined,
      platform: 'browser',
      build: 'default',
    });
  });

  it('inherits the top-level platform when a shared entry omits one', () => {
    const result = withNativeFederation({
      platform: 'node',
      shared: { react: {} },
    });

    expect(result.shared['react'].platform).toBe('node');
    expect(result.platform).toBe('node');
  });

  it('normalizes backslashes in shared keys to forward slashes', () => {
    const config = { shared: { 'scope\\pkg': {} } } as unknown as FederationConfig;
    const result = withNativeFederation(config);

    expect(Object.keys(result.shared)).toEqual(['scope/pkg']);
  });

  it('removes shared externals that are in the skip list', () => {
    const result = withNativeFederation({
      shared: { react: {}, skipped: {} },
      skip: ['skipped'],
    });

    expect(Object.keys(result.shared)).toEqual(['react']);
  });

  // An external without build is built in browser-shared/node-shared, which takes the global
  // chunks, so its own value can only be reported, never applied (core#216).
  describe('chunks on a shared external', () => {
    it.each([
      [false, true],
      [true, false],
    ])('warns when chunks: %s is set without build under global chunks: %s', (own, global) => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({ chunks: global, shared: { react: { chunks: own } } });

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain("'react'");
      expect(result.shared['react']!.chunks).toBeUndefined();
    });

    it('warns under the default global chunks, which is true', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({ shared: { rxjs: { singleton: true, chunks: false } } });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("'rxjs'"));
    });

    it('does not warn when chunks matches the global value', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({ chunks: false, shared: { react: { chunks: false } } });

      expect(warn).not.toHaveBeenCalled();
    });

    // shareAll({ chunks: false }) copies the value onto every package and secondary.
    it('reports each package once, however many of its secondaries inherit the value', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({
        shared: {
          '@angular/core': { chunks: false },
          '@angular/core/rxjs-interop': { chunks: false },
          rxjs: { chunks: false },
          'rxjs/operators': { chunks: false },
        },
      });

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain("'@angular/core', 'rxjs'");
      expect(warn.mock.calls[0]![0]).not.toContain('rxjs-interop');
    });

    it('does not report an external in the skip list', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({ shared: { skipped: { chunks: false } }, skip: ['skipped'] });

      expect(warn).not.toHaveBeenCalled();
    });

    it('keeps chunks on an external with a bundle of its own', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        chunks: false,
        shared: { react: { chunks: true, build: 'package' } },
      });

      expect(warn).not.toHaveBeenCalled();
      expect(result.shared['react']!.chunks).toBe(true);
    });

    // Unset is no vote, so the planner can tell it from a value that happens to equal the global.
    it('leaves chunks unset on an external with a bundle of its own that does not set it', () => {
      const result = withNativeFederation({ shared: { react: { build: 'package' } } });

      expect(result.shared['react']).not.toHaveProperty('chunks');
    });

    // The direction the old check reset in place, which a frozen object turns into a TypeError.
    it("does not write into the user's config", () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const react = Object.freeze({ chunks: true });

      expect(() => withNativeFederation({ chunks: false, shared: { react } })).not.toThrow();
      expect(react.chunks).toBe(true);
    });

    // A normalized config passed back in carries build: 'default'; it is not a bundle of its own.
    it("warns for an explicit build: 'default' like for no build", () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: { rxjs: { build: 'default', chunks: false } as unknown as ExternalConfig },
      });

      expect(warn).toHaveBeenCalledOnce();
      expect(result.shared['rxjs']!.chunks).toBeUndefined();
    });

    // W15: chunks is a package setting, so the main entry's value builds the whole package.
    it("gives entries of one package the package's chunks, with one warning", () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: {
          '@org/ui/button': { build: 'package', chunks: false },
          '@org/ui': { build: 'package', chunks: true },
          '@org/ui/card': { build: 'package', chunks: false },
        },
      });

      expect(Object.values(result.shared).map(cfg => cfg.chunks)).toEqual([true, true, true]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain(
        "Entry points of shared package '@org/ui' set different chunks."
      );
    });

    it('does not warn when an entry of a package bundle leaves chunks unset', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({
        shared: {
          '@org/ui': { build: 'package', chunks: false },
          '@org/ui/button': { build: 'package' },
        },
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it('warns when members of one pool disagree, naming the pool bundle', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({
        shared: {
          libA: { build: 'pool', pool: 'p1', chunks: true },
          libB: { build: 'pool', pool: 'p1', chunks: false },
        },
      });

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain("'browser-pool-p1'");
    });

    // Platform stays per entry point; chunks still comes from the package.
    it('gives an entry built for another platform the package chunks', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: {
          '@org/ui': { build: 'package', chunks: true },
          '@org/ui/server': { build: 'package', chunks: false, platform: 'node' },
        },
      });

      expect(result.shared['@org/ui/server']).toMatchObject({ chunks: true, platform: 'node' });
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  // W15: config is per package, like an npm package, not per entry point.
  describe('one config per package', () => {
    const fields = (cfg: { [key: string]: unknown }) => ({
      requiredVersion: cfg['requiredVersion'],
      singleton: cfg['singleton'],
      strictVersion: cfg['strictVersion'],
      version: cfg['version'],
      pool: cfg['pool'],
    });

    it("gives every entry point the main entry's config, wherever it is listed", () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const main = {
        requiredVersion: '^7.0.0',
        singleton: true,
        strictVersion: true,
        version: '7.8.1',
        pool: 'a',
      };

      const result = withNativeFederation({
        shared: {
          'rxjs/operators': {
            requiredVersion: '^6.0.0',
            singleton: false,
            strictVersion: false,
            version: '6.0.0',
            pool: 'b',
          },
          rxjs: main,
        },
      });

      expect(fields(result.shared['rxjs/operators']!)).toEqual(main);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toBe(
        "Entry points of shared package 'rxjs' set different requiredVersion, singleton, " +
          'strictVersion, version, pool. A package is shared with one config, taken from its ' +
          "main entry; the other entry points' values are ignored. Set them once, on 'rxjs'."
      );
    });

    it('takes the config from the first entry point listed when there is no main entry', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: {
          '@org/ui/table': { singleton: true, pool: 'a' },
          '@org/ui/button': { singleton: true, pool: 'b' },
        },
      });

      expect(result.shared['@org/ui/button']!.pool).toBe('a');
      expect(warn.mock.calls[0]![0]).toContain("taken from its first entry point, '@org/ui/table'");
    });

    // The pool picks the bundle, so the package is built where its record says it lives.
    it('builds every entry point in the pool of the package', () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: {
          rxjs: { build: 'pool', pool: 'a' },
          'rxjs/operators': { build: 'pool', pool: 'b' },
        },
      });

      expect(result.shared['rxjs/operators']).toMatchObject({ build: 'pool', pool: 'a' });
    });

    it('lets an entry point that leaves a field unset inherit it silently', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: { rxjs: { singleton: true, pool: 'a' }, 'rxjs/operators': {} },
      });

      expect(result.shared['rxjs/operators']).toMatchObject({ singleton: true, pool: 'a' });
      expect(warn).not.toHaveBeenCalled();
    });

    // The shapes shareAll() and share() return: shareAll() resolves 'auto' to a range and sets no
    // version, while share() with requiredVersion 'auto' also stamps the version it read.
    it('does not report a version core derived for a share() entry under a shareAll() root', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const root = { singleton: true, strictVersion: true, requiredVersion: '^20.1.0' };

      const result = withNativeFederation({
        shared: {
          '@angular/common': root,
          '@angular/common/locales/de': { ...root, version: '20.1.0' },
        },
      });

      expect(result.shared['@angular/common/locales/de']!.version).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('reports a version set apart from the version of the package', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      withNativeFederation({
        shared: { rxjs: { version: '7.8.1' }, 'rxjs/operators': { version: '7.0.0' } },
      });

      expect(warn.mock.calls[0]![0]).toContain("'rxjs' set different version.");
    });

    // build and pool move together, so a secondary's pool never outlives its build.
    it('builds a package whose entry points mix build and pool, with one warning', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: {
          rxjs: { build: 'package' },
          'rxjs/operators': { build: 'pool', pool: 'x', shareScope: 'other' },
        },
      });

      expect(result.shared['rxjs/operators']).toMatchObject({ build: 'package' });
      expect(result.shared['rxjs/operators']).not.toHaveProperty('pool');
      expect(result.shared['rxjs/operators']).not.toHaveProperty('shareScope');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain('set different build, pool, shareScope.');
    });

    it('lets an entry point inherit chunks with the build it applies to, without a warning', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: { rxjs: { build: 'package', chunks: false }, 'rxjs/operators': {} },
      });

      expect(result.shared['rxjs/operators']).toMatchObject({ build: 'package', chunks: false });
      expect(warn).not.toHaveBeenCalled();
    });

    it('ignores preload set on an entry point apart from its package', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: { 'chart-lib': {}, 'chart-lib/extras': { preload: true } },
      });

      expect(result.shared['chart-lib/extras']).not.toHaveProperty('preload');
      expect(warn.mock.calls[0]![0]).toContain('set different preload.');
    });

    it('lets a skipped main entry configure nothing', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = withNativeFederation({
        shared: { rxjs: { pool: 'a' }, 'rxjs/operators': { pool: 'b' } },
        skip: ['rxjs'],
      });

      expect(Object.keys(result.shared)).toEqual(['rxjs/operators']);
      expect(result.shared['rxjs/operators']!.pool).toBe('b');
      expect(warn).not.toHaveBeenCalled();
    });

    it('leaves agreeing entry points and other packages alone', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const cfg = { singleton: true, strictVersion: true, requiredVersion: '^7.0.0' };

      const result = withNativeFederation({
        shared: { rxjs: cfg, 'rxjs/operators': cfg, tslib: { singleton: false } },
      });

      expect(fields(result.shared['rxjs/operators']!)).toEqual(fields(result.shared['rxjs']!));
      expect(result.shared['tslib']!.singleton).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('includes shareScope only when configured', () => {
    expect(withNativeFederation({}).shareScope).toBeUndefined();
    expect(withNativeFederation({ shareScope: 'custom' }).shareScope).toBe('custom');
  });

  it('passes a per-external shareScope through normalization', () => {
    const result = withNativeFederation({
      shared: { react: { shareScope: 'isolated' } },
    });

    expect(result.shared['react'].shareScope).toBe('isolated');
  });

  it.each([undefined, '', '-'])("throws when build: 'pool' has pool: %j", pool => {
    expect(() => withNativeFederation({ shared: { libA: { build: 'pool', pool } } })).toThrow(
      "Shared external 'libA' sets build: 'pool' without a pool."
    );
  });

  it('passes a per-external pool through normalization', () => {
    const result = withNativeFederation({
      shared: { react: { pool: 'critical' } },
    });

    expect(result.shared['react'].pool).toBe('critical');
  });

  it('omits pool when it is not configured', () => {
    const result = withNativeFederation({
      shared: { react: {} },
    });

    expect(result.shared['react'].pool).toBeUndefined();
    expect(result.shared['react']).not.toHaveProperty('pool');
  });

  it('normalizes preload to true when it is set', () => {
    const result = withNativeFederation({
      shared: { 'chart-lib': { preload: true } },
    });

    expect(result.shared['chart-lib'].preload).toBe(true);
  });

  // An explicit false and an absent flag must publish the same remoteEntry.json.
  it.each([[{}], [{ preload: false }]])('omits preload when it is %j', sharedConfig => {
    const result = withNativeFederation({
      shared: { 'chart-lib': sharedConfig },
    });

    expect(result.shared['chart-lib']).not.toHaveProperty('preload');
  });

  // preload is a package field: the main entry's value applies to every entry point.
  it('sets preload on every entry point of a package whose main entry sets it', () => {
    const result = withNativeFederation({
      shared: {
        'chart-lib': { build: 'package', preload: true },
        'chart-lib/extras': { build: 'package' },
        rxjs: {},
      },
    });

    expect(result.shared['chart-lib/extras'].preload).toBe(true);
    expect(result.shared['rxjs']).not.toHaveProperty('preload');
  });

  // Each record lists its own chunks, so a package in a bundle with others preloads only its own.
  it.each([
    ['the combined bundle', {}],
    ['a pool bundle', { build: 'pool', pool: 'p1' }],
  ] as const)('stays quiet about a preload package in %s', (_, cfg) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    withNativeFederation({ shared: { 'chart-lib': { ...cfg, preload: true } } });

    expect(warn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('normalizes declared packages with the mapping defaults', () => {
    getRawMappedPaths.mockReturnValue({
      paths: { '/ws/libs/lib/index.ts': '@org/lib' },
      configs: {},
      keys: ['@org/lib'],
      packages: { '@org/lib': { singleton: false, pool: 'lib' } },
    });

    const result = withNativeFederation({});

    expect(result.sharedMappingPackages).toEqual({
      '@org/lib': { singleton: false, strictVersion: true, pool: 'lib' },
    });
  });

  // 'combined' was the explicit spelling of no build; v5 drops it, so 4.x never accepts it.
  it("rejects build: 'combined' on a mapping", () => {
    getRawMappedPaths.mockReturnValue({
      paths: { '/ws/libs/a/index.ts': '@org/a' },
      configs: { '@org/a': { build: 'combined' } as never },
      keys: ['@org/a'],
    });

    expect(() => withNativeFederation({})).toThrow(
      "Mapping '@org/a' sets build: 'combined'; a mapping takes 'separate' or 'package'."
    );
  });

  it('leaves sharedMappingPackages out without declarations', () => {
    expect(withNativeFederation({})).not.toHaveProperty('sharedMappingPackages');
  });

  it('rejects a declared prefix that is not a package name', () => {
    getRawMappedPaths.mockReturnValue({ paths: {}, configs: {}, packages: { '@org': {} } });
    expect(() => withNativeFederation({})).toThrow(
      "Shared mapping package '@org' is not a package name"
    );
  });

  // The package's config goes ahead of every pattern, so this one would never apply.
  it('rejects a config under a declared package', () => {
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: { '@org/lib/testing': { singleton: false } },
      keys: ['@org/lib', '@org/lib/testing'],
      packages: { '@org/lib': {} },
    });
    expect(() => withNativeFederation({})).toThrow(
      "Shared mapping config '@org/lib/testing' sits under declared package '@org/lib'"
    );
  });

  // A hand-written `[['@org/lib/*'], {}]` only selects, like the bare string the builder emits.
  it('accepts an empty config under a declared package', () => {
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: { '@org/lib/*': {} },
      keys: ['@org/lib', '@org/lib/*'],
      packages: { '@org/lib': {} },
    });
    expect(() => withNativeFederation({})).not.toThrow();
  });

  it('warns for a declared package no tsconfig key reaches', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: {},
      keys: ['@org/lib'],
      packages: { '@org/lbi': {} },
    });

    withNativeFederation({});

    expect(warn).toHaveBeenCalledWith(
      "Shared mapping package '@org/lbi' covers no tsconfig paths key."
    );
  });

  it('warns for a selected mapping the tsconfig it read has no key for', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getRawMappedPaths.mockReturnValue({ paths: {}, configs: {}, keys: [], patterns: ['@org/ui'] });

    withNativeFederation({ sharedMappings: ['@org/ui'] });

    expect(warn).toHaveBeenCalledWith(
      "Shared mapping '@org/ui' matches no paths key in /ws/tsconfig.json, which defines no paths, so it is not shared."
    );
  });

  // groundwork/06: no tsconfig reads like a tsconfig without paths.
  describe('without a tsconfig', () => {
    beforeEach(() => findMappingsTsConfig.mockReturnValue(undefined));

    it('shares no mappings and does not throw', () => {
      const result = withNativeFederation({});

      expect(getRawMappedPaths).toHaveBeenCalledWith(undefined, undefined);
      expect(result.sharedMappings).toEqual({});
    });

    it('names the missing tsconfig for a declared pattern', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      getRawMappedPaths.mockReturnValue({ paths: {}, configs: {}, keys: [], patterns: ['@org/*'] });

      withNativeFederation({ sharedMappings: ['@org/*'] });

      expect(warn).toHaveBeenCalledWith(
        "Shared mapping '@org/*' matches no paths key as no tsconfig was found, so it is not shared."
      );
    });
  });

  // An untyped config from 4.9.0-next.1 can still carry it.
  it("rejects build: 'paths' on a mapping, pointing at .package()", () => {
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: { '@org/*': { build: 'paths' } },
    });
    expect(() => withNativeFederation({})).toThrow(
      /Mapping '@org\/\*' sets build: 'paths'.*mappingsFromWorkspace\(\)\.package/
    );
  });

  it('builds shared mappings from the resolved tsconfig, filtering the skip list', () => {
    getRawMappedPaths.mockReturnValue({
      paths: {
        '/ws/libs/ui/index.ts': '@org/ui',
        '/ws/libs/skip/index.ts': '@org/skip',
      },
      configs: {},
    });

    const result = withNativeFederation({
      sharedMappings: ['@org/ui', '@org/skip'],
      skip: ['@org/skip'],
    });

    expect(findMappingsTsConfig).toHaveBeenCalled();
    expect(getRawMappedPaths).toHaveBeenCalledWith('/ws/tsconfig.json', ['@org/ui', '@org/skip']);
    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
  });

  it('normalizes mapping configs, defaulting to the current hardcoded behaviour', () => {
    getRawMappedPaths.mockReturnValue({
      paths: { '/ws/libs/ui/index.ts': '@org/ui' },
      configs: { '@org/ui': {} },
    });

    const result = withNativeFederation({ sharedMappings: [[['@org/ui'], {}]] });

    expect(result.sharedMappingsConfig).toEqual({
      '@org/ui': { singleton: true, strictVersion: true },
    });
  });

  // strictVersion tracks the mappingVersion flag, matching what toSharedMappingInfo does today.
  it('defaults strictVersion from the mappingVersion feature flag', () => {
    getRawMappedPaths.mockReturnValue({ paths: {}, configs: { '@org/ui': {} } });

    const result = withNativeFederation({
      sharedMappings: [[['@org/ui'], {}]],
      features: { mappingVersion: false },
    });

    expect(result.sharedMappingsConfig['@org/ui']).toMatchObject({ strictVersion: false });
  });

  it('keeps explicitly configured mapping values', () => {
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: {
        '@org/ui': {
          singleton: false,
          requiredVersion: '^2.0.0',
          shareScope: 'custom',
          pool: 'p1',
          includeSecondaries: { keepAll: true },
        },
      },
    });

    const result = withNativeFederation({ sharedMappings: [[['@org/ui'], {}]] });

    expect(result.sharedMappingsConfig['@org/ui']).toEqual({
      singleton: false,
      strictVersion: true,
      requiredVersion: '^2.0.0',
      shareScope: 'custom',
      pool: 'p1',
      includeSecondaries: true,
    });
  });

  // The version it formats is only read at build time.
  it('carries an object-form requiredVersion through unresolved', () => {
    getRawMappedPaths.mockReturnValue({
      paths: {},
      configs: { '@org/ui': { requiredVersion: { range: '^' as const } } },
    });

    const result = withNativeFederation({ sharedMappings: [[['@org/ui'], {}]] });

    expect(result.sharedMappingsConfig['@org/ui']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: { range: '^' },
    });
  });

  it('respects explicit feature flags', () => {
    const result = withNativeFederation({
      features: { mappingVersion: false, integrityHashes: true },
    });

    expect(result.features).toEqual({
      mappingVersion: false,
      ignoreUnusedDeps: true,
      denseChunking: true,
      denseExternals: true,
      integrityHashes: true,
      synthesizeCjsExports: true,
      strictImports: false,
    });
  });

  // The flags left the config type; a config that still sets them builds dense without a word,
  // preload included (flat chunking used to warn that it preloads no chunks).
  it.each([
    [{ denseChunking: false, denseExternals: false }],
    [{ denseChunking: true }],
    [{ denseExternals: false }],
  ])('reads the removed dense flags as true for %j, silently', features => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const notice = vi.spyOn(logger, 'notice').mockImplementation(() => undefined);

    const result = withNativeFederation({
      shared: { 'chart-lib': { build: 'package', preload: true } },
      features,
    } as FederationConfig);

    expect(result.features).toMatchObject({ denseChunking: true, denseExternals: true });
    expect(warn).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  it('passes the configured name and externals through', () => {
    const result = withNativeFederation({ name: 'mfe1', externals: ['rxjs'] });

    expect(result.name).toBe('mfe1');
    expect(result.externals).toEqual(['rxjs']);
  });
});
