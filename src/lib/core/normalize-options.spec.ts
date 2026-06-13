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
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      integrityHashes: false,
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
    expect(result.options.federationCache).toBe(cache);
  });

  it('loads the config through the injected ConfigLoader (no disk import)', async () => {
    const io = createMemoryIo().setFile(CONFIG_PATH, '');
    const loadConfig = vi.fn(async () => makeConfig({ name: 'custom' }));

    await normalizeFederationOptionsCore({ io, loadConfig }, baseOptions, cache);

    expect(loadConfig).toHaveBeenCalledWith(CONFIG_PATH);
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
});
