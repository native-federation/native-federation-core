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
  getRawMappedPaths: (...args: unknown[]) => getRawMappedPaths(...args),
}));

import { withNativeFederation } from './with-native-federation.js';
import { logger } from '../utils/logger.js';
import type {
  FederationConfig,
  MappingConfigInput,
} from '../domain/config/federation-config.contract.js';
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
        denseChunking: false,
        denseExternals: false,
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
      chunks: true,
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

  it('warns and overrides chunks when an external sets chunks without a build type', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = withNativeFederation({
      chunks: false,
      shared: { react: { chunks: true } },
    });

    expect(warn).toHaveBeenCalled();
    expect(result.shared['react'].chunks).toBe(false);
  });

  it('does not warn when an explicit build type accompanies chunk settings', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = withNativeFederation({
      chunks: false,
      shared: { react: { chunks: true, build: 'package' } },
    });

    expect(warn).not.toHaveBeenCalled();
    expect(result.shared['react'].chunks).toBe(true);
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
      features: { mappingVersion: false, denseChunking: true, denseExternals: true },
    });

    expect(result.features).toEqual({
      mappingVersion: false,
      ignoreUnusedDeps: true,
      denseChunking: true,
      denseExternals: true,
      integrityHashes: false,
      synthesizeCjsExports: true,
      strictImports: false,
    });
  });

  it('passes the configured name and externals through', () => {
    const result = withNativeFederation({ name: 'mfe1', externals: ['rxjs'] });

    expect(result.name).toBe('mfe1');
    expect(result.externals).toEqual(['rxjs']);
  });

  // core#198: a declared package may never be coarser than the name rule, so consumers that ignore
  // the declaration (orchestrator 4.8.0) still group safely.
  describe('package declarations', () => {
    const load = (
      configs: Record<string, MappingConfigInput>,
      features: FederationConfig['features'] = { denseExternals: true }
    ) => {
      getRawMappedPaths.mockReturnValue({ paths: {}, configs });
      return withNativeFederation({ sharedMappings: [], features });
    };

    it.each([
      ['@shared/forms', '@shared/forms'],
      ['@shared/forms/input', '@shared/forms'],
      ['@shared/forms/*', '@shared/forms'],
      ['@shared/components/table', '@shared/components/table'],
      ['ui/table', 'ui'],
    ])("accepts '%s' declaring '%s'", (pattern, packageName) => {
      const result = load({ [pattern]: { package: packageName } });

      expect(result.sharedMappingsConfig[pattern]).toMatchObject({ package: packageName });
    });

    it.each([
      ['@shared/forms', '@shared', 'shallower than @scope/name'],
      ['@shared/forms', '@shared/form', "not '/'-aligned"],
      ['@shared/*', '@shared/forms', 'the pattern also matches other packages'],
      ['@shared/forms*', '@shared/forms', "the wildcard also matches '@shared/forms-x'"],
      ['@shared/forms', 'rxjs', 'another package'],
      ['@shared/forms', '@shared/forms/', 'a trailing slash'],
      ['*', '@shared/forms', 'the catch-all matches every package'],
      ['@shared/forms/*', '@shared/forms/input', 'deeper than the wildcard prefix'],
      ['@shared/forms/*', '@shared/forms/*', 'a wildcard in the name'],
    ])("rejects '%s' declaring '%s' (%s)", (pattern, packageName) => {
      expect(() => load({ [pattern]: { package: packageName } })).toThrow(
        `Mapping '${pattern}' declares package '${packageName}'`
      );
    });

    // A JS config is not type-checked.
    it.each([false, null, 1, ''])('rejects package: %j', value => {
      expect(() =>
        load({ '@shared/forms': { package: value as unknown as string, build: 'package' } })
      ).toThrow(`Mapping '@shared/forms' sets 'package' to ${JSON.stringify(value)}`);
    });

    it('accepts package: true on any pattern, since a mapping is never coarser than itself', () => {
      const result = load({ '*': { package: true } });

      expect(result.sharedMappingsConfig['*']).toMatchObject({ package: true });
    });

    it.each(['separate', 'package'] as const)('rejects package together with build: %s', build => {
      expect(() => load({ '@shared/forms': { package: true, build } })).toThrow(
        `Mapping '@shared/forms' sets both 'package' and 'build: ${build}'`
      );
    });

    it('rejects package on a shared npm package', () => {
      expect(() =>
        withNativeFederation({
          shared: { react: { singleton: true, package: true } as ExternalConfig },
        })
      ).toThrow("Shared external 'react' sets 'package'");
    });

    // A spread of a mapping config can carry the key without a value.
    it('accepts a shared npm package whose package is undefined', () => {
      const result = withNativeFederation({
        shared: { react: { singleton: true, package: undefined } as ExternalConfig },
      });

      expect(Object.keys(result.shared)).toEqual(['react']);
    });

    // Flat output has no group to put the package name in.
    it('warns once and drops the declaration when denseExternals is off', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = load(
        { '@shared/forms': { package: true }, '@shared/table': { package: '@shared/table' } },
        {}
      );

      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("'@shared/forms', '@shared/table' declare a 'package'")
      );
      expect(result.sharedMappingsConfig['@shared/forms']).not.toHaveProperty('package');
      expect(result.sharedMappingsConfig['@shared/table']).not.toHaveProperty('package');
    });

    it('still rejects an invalid declaration when denseExternals is off', () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      expect(() => load({ '@shared/forms': { package: '@shared' } }, {})).toThrow(
        "declares package '@shared'"
      );
    });

    it('does not warn without a declaration', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      load({ '@shared/forms': {} }, {});

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
