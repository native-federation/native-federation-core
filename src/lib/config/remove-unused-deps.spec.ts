import { describe, expect, it } from 'vitest';
import { removeUnusedDeps } from './remove-unused-deps.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../domain/config/external-config.contract.js';
import type { UsedDependencies } from '../domain/utils/used-dependencies.contract.js';

const external = (overrides: Partial<NormalizedExternalConfig> = {}): NormalizedExternalConfig => ({
  singleton: false,
  strictVersion: false,
  requiredVersion: 'auto',
  chunks: true,
  platform: 'browser',
  build: 'default',
  ...overrides,
});

const makeConfig = (
  shared: NormalizedFederationConfig['shared']
): NormalizedFederationConfig => ({
  $type: 'classic',
  name: 'app',
  exposes: {},
  shared,
  sharedMappings: {},
  skip: { strings: new Set(), functions: [], regexps: [] },
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

describe('removeUnusedDeps', () => {
  it('keeps only shared deps that are actually used externally', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const config = makeConfig({ keep: external(), drop: external() });

    const result = removeUnusedDeps(used, config);

    expect(Object.keys(result.shared)).toEqual(['keep']);
  });

  it('always keeps deps flagged with includeSecondaries, even when unused', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig({ lib: external({ includeSecondaries: true }) });

    const result = removeUnusedDeps(used, config);

    expect(Object.keys(result.shared)).toEqual(['lib']);
  });

  it('preserves the meta object of retained dependencies', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const meta = external({ singleton: true, requiredVersion: '^1.0.0' });
    const config = makeConfig({ keep: meta });

    const result = removeUnusedDeps(used, config);

    expect(result.shared['keep']).toEqual(meta);
  });

  it('replaces sharedMappings with the used internal mappings', () => {
    const used: UsedDependencies = {
      external: new Set(),
      internal: { '/ws/libs/ui/index.ts': '@org/ui' },
    };
    const config = makeConfig({});

    const result = removeUnusedDeps(used, config);

    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
  });

  it('does not mutate the original config', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const config = makeConfig({ keep: external(), drop: external() });

    removeUnusedDeps(used, config);

    expect(Object.keys(config.shared)).toEqual(['keep', 'drop']);
  });

  it('leaves the rest of the config untouched', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig({});

    const result = removeUnusedDeps(used, config);

    expect(result.name).toBe('app');
    expect(result.$type).toBe('classic');
    expect(result.features).toEqual(config.features);
  });
});
