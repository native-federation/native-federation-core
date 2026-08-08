import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { normalizeFederationOptionsCore } from './normalize-options.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { prepareSkipList } from '../config/default-skip-list.js';
import { logger } from '../utils/logger.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import type { FederationCache } from '../domain/core/federation-cache.contract.js';

const CONFIG_PATH = path.join('/ws', 'federation.config.js');

const cache: FederationCache = {
  externals: [],
  bundlerCache: undefined,
  cachePath: '/cache',
};

const baseOptions: FederationOptions = {
  workspaceRoot: '/ws',
  outputPath: 'dist',
  federationConfig: 'federation.config.js',
};

function makeConfig(
  overrides: Partial<NormalizedFederationConfig> = {}
): NormalizedFederationConfig {
  return {
    $type: 'classic',
    name: 'my-app',
    exposes: { './Comp': { file: './src/comp.ts' } },
    shared: {},
    sharedMappings: {},
    sharedMappingsConfig: {},
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals: false,
      integrityHashes: false,
      synthesizeCjsExports: true,
    },
    ...overrides,
  };
}

const loaderFor = (config: NormalizedFederationConfig) => async () => config;

describe('normalizeFederationOptionsCore', () => {
  it('throws when the federation config file does not exist', async () => {
    const io = createMemoryIo();
    await expect(
      normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions,
        cache
      )
    ).rejects.toThrow(/Expected/);
  });

  it('derives entryPoints, projectName and defaults from the loaded config', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const config = makeConfig();

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config) },
      baseOptions,
      cache
    );

    expect(result.config).toBe(config);
    expect(result.options.entryPoints).toEqual(['./src/comp.ts']);
    expect(result.options.projectName).toBe('my_app');
    expect(result.options.cacheExternalArtifacts).toBe(true);
    expect(result.options.federationCache).toEqual({
      ...cache,
      cachePath: path.join('/cache', 'my_app'),
    });
  });

  describe('project-scoped cachePath', () => {
    // buildForFederation used to append projectName on every call, so one cache object serving two
    // builds ended up at '/cache/app/app'. Scoping here happens once per normalize instead.
    it('scopes the supplied cache path to the project', async () => {
      const io = createMemoryIo().setFile(CONFIG_PATH, '');

      const result = await normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions,
        cache
      );

      expect(result.options.federationCache.cachePath).toBe(path.join('/cache', 'my_app'));
    });

    it('derives the scoped path from the workspace when no cache is supplied', async () => {
      const io = createMemoryIo().setFile(CONFIG_PATH, '');

      const result = await normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions
      );

      expect(result.options.federationCache.cachePath).toBe(
        path.join('/ws', 'node_modules/.cache/native-federation', 'my_app')
      );
    });

    it('leaves the supplied cache untouched so it can be normalized again', async () => {
      const io = createMemoryIo().setFile(CONFIG_PATH, '');
      const supplied: FederationCache = { externals: [], bundlerCache: undefined, cachePath: '/c' };

      const first = await normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions,
        supplied
      );
      const second = await normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions,
        supplied
      );

      expect(supplied.cachePath).toBe('/c');
      expect(second.options.federationCache.cachePath).toBe(
        first.options.federationCache.cachePath
      );
    });

    it('keeps the bundler cache identity so callers can still reach into it', async () => {
      const io = createMemoryIo().setFile(CONFIG_PATH, '');
      const bundlerCache = { marker: true };
      const supplied: FederationCache<typeof bundlerCache> = {
        externals: [],
        bundlerCache,
        cachePath: '/c',
      };

      const result = await normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(makeConfig()) },
        baseOptions,
        supplied
      );

      expect(result.options.federationCache.bundlerCache).toBe(bundlerCache);
    });
  });

  it('loads the config through the injected ConfigLoader (no disk import)', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const loadConfig = vi.fn(async () => makeConfig({ name: 'custom' }));

    await normalizeFederationOptionsCore({ io, loadConfig }, baseOptions, cache);

    expect(loadConfig).toHaveBeenCalledWith(CONFIG_PATH);
  });

  it('prunes unused shared deps via the injected factory when ignoreUnusedDeps is on', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const config = makeConfig({
      shared: { keep: {}, drop: {} },
      features: { ...makeConfig().features, ignoreUnusedDeps: true },
    });
    // Fake factory: only "keep" is reported used, plus a resolved mapping.
    const usedDependenciesFactory = vi.fn(() => () => ({
      external: new Set(['keep']),
      internal: { '/ws/libs/ui/x.ts': '@org/ui/x' },
    }));

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config), usedDependenciesFactory },
      baseOptions,
      cache
    );

    expect(usedDependenciesFactory).toHaveBeenCalledWith('/ws', undefined);
    expect(Object.keys(result.config.shared)).toEqual(['keep']);
    expect(result.config.sharedMappings).toEqual({ '/ws/libs/ui/x.ts': '@org/ui/x' });
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('skips the used dependency scan when nothing is shared', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const usedDependenciesFactory = vi.fn(() => () => ({ external: new Set(), internal: {} }));
    const config = makeConfig({
      shared: {},
      sharedMappings: {},
      features: { ...makeConfig().features, ignoreUnusedDeps: true },
    });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config), usedDependenciesFactory },
      baseOptions,
      cache
    );

    expect(usedDependenciesFactory).not.toHaveBeenCalled();
    expect(result.config.shared).toEqual({});
    expect(result.config.sharedMappings).toEqual({});
  });

  it('still runs the scan when only shared mappings are configured', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const usedDependenciesFactory = vi.fn(() => () => ({
      external: new Set<string>(),
      internal: { '/ws/libs/ui/x.ts': '@org/ui/x' },
    }));
    const config = makeConfig({
      shared: {},
      sharedMappings: { '/ws/libs/ui': '@org/ui' },
      features: { ...makeConfig().features, ignoreUnusedDeps: true },
    });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config), usedDependenciesFactory },
      baseOptions,
      cache
    );

    expect(usedDependenciesFactory).toHaveBeenCalled();
    expect(result.config.sharedMappings).toEqual({ '/ws/libs/ui/x.ts': '@org/ui/x' });
    vi.restoreAllMocks();
  });

  it('drops wildcard shared mappings and warns when ignoreUnusedDeps is off', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const config = makeConfig({ sharedMappings: { './a/*': 'lib/a/*', './b': 'lib/b' } });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config) },
      baseOptions,
      cache
    );

    expect(result.config.sharedMappings).toEqual({ './b': 'lib/b' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // resolveGlob materialises the pattern, so there is nothing left to warn about.
  it('expands rather than drops a resolveGlob wildcard when ignoreUnusedDeps is off', async () => {
    const io = createMemoryIo()
      .setFile(CONFIG_PATH, '')
      .setFile(path.join('/ws', 'libs/ui/button/index.ts'), '');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const config = makeConfig({
      sharedMappings: { [path.join('/ws', 'libs/ui/*/index.ts')]: '@org/ui/*' },
      sharedMappingsConfig: {
        '@org/ui/*': {
          singleton: true,
          strictVersion: true,
          resolveGlob: true,
        },
      },
    });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config) },
      baseOptions,
      cache
    );

    expect(result.config.sharedMappings).toEqual({
      [path.join('/ws', 'libs/ui/button/index.ts')]: '@org/ui/button',
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // The rule is "would it be published in remoteEntry.json?". Reachability puts a deep import
  // there, so it throws; the two tests after this cover the paths that never publish one.
  it('throws when a reachability-resolved mapping is not a barrel import', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    // A mapping has to be declared for the scan to run at all; reachability then resolves it
    // to the deep import below, which is what gets published.
    const config = makeConfig({
      sharedMappings: { [path.join('/ws', 'libs/ui/*')]: '@org/ui/*' },
      features: { ...makeConfig({}).features, ignoreUnusedDeps: true },
    });
    const usedDependenciesFactory = () => () => ({
      external: new Set<string>(),
      internal: {
        '/ws/libs/ui/button/button.component.ts': '@org/ui/button/button.component',
      },
    });

    await expect(
      normalizeFederationOptionsCore(
        { io, loadConfig: loaderFor(config), usedDependenciesFactory },
        baseOptions,
        cache
      )
    ).rejects.toThrow(/Only barrel imports can be shared/);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Only barrel imports can be shared'));
  });

  // Pruning already removed it, so it is never published and there is nothing to complain about.
  it('does not throw for a non-barrel mapping that pruning removed', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const config = makeConfig({
      sharedMappings: { '/ws/libs/ui/button/button.component.ts': '@org/ui/button.component' },
      features: { ...makeConfig({}).features, ignoreUnusedDeps: true },
    });
    const usedDependenciesFactory = () => () => ({
      external: new Set<string>(),
      internal: {},
    });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config), usedDependenciesFactory },
      baseOptions,
      cache
    );

    expect(result.config.sharedMappings).toEqual({});
    vi.restoreAllMocks();
  });

  // With pruning off nothing is dropped, so the same mapping does reach remoteEntry.json and
  // therefore does throw. Turning pruning off is opting into publishing what you mapped.
  it('throws for a non-barrel mapping when ignoreUnusedDeps is off', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const config = makeConfig({
      sharedMappings: { '/ws/libs/ui/button/button.component.ts': '@org/ui/button.component' },
    });

    await expect(
      normalizeFederationOptionsCore({ io, loadConfig: loaderFor(config) }, baseOptions, cache)
    ).rejects.toThrow(/Only barrel imports can be shared/);

    vi.restoreAllMocks();
  });

  // resolveGlob is a guess, so it drops non-barrel matches before they can be published.
  it('does not throw for non-barrel files a resolveGlob wildcard matched', async () => {
    const io = createMemoryIo()
      .setFile(CONFIG_PATH, '')
      .setFile(path.join('/ws', 'libs/ui/button/index.ts'), '')
      .setFile(path.join('/ws', 'libs/ui/button/button.component.ts'), '');

    const config = makeConfig({
      sharedMappings: { [path.join('/ws', 'libs/ui/*')]: '@org/ui/*' },
      sharedMappingsConfig: {
        '@org/ui/*': { singleton: true, strictVersion: true, resolveGlob: true },
      },
    });

    const result = await normalizeFederationOptionsCore(
      { io, loadConfig: loaderFor(config) },
      baseOptions,
      cache
    );

    expect(result.config.sharedMappings).toEqual({
      [path.join('/ws', 'libs/ui/button/index.ts')]: '@org/ui/button',
    });
  });
});
