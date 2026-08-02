import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { removeUnusedDeps } from './remove-unused-deps.js';
import { logger } from '../utils/logger.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { prepareSkipList } from './default-skip-list.js';
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
  shared: NormalizedFederationConfig['shared'],
  overrides: Partial<NormalizedFederationConfig> = {}
): NormalizedFederationConfig => ({
  $type: 'classic',
  name: 'app',
  exposes: {},
  shared,
  sharedMappings: {},
  sharedMappingsConfig: {},
  skip: { strings: new Set(), functions: [], regexps: [] },
  chunks: true,
  externals: [],
  features: {
    mappingVersion: true,
    ignoreUnusedDeps: true,
    denseChunking: false,
    denseExternals: false,
    integrityHashes: false,
    synthesizeCjsExports: true,
  },
  ...overrides,
});

const WS = path.resolve('/ws');

const run = (used: UsedDependencies, config: NormalizedFederationConfig, io = createMemoryIo()) =>
  removeUnusedDeps(used, config, { io, workspaceRoot: WS });

describe('removeUnusedDeps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps only shared deps that are actually used externally', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const config = makeConfig({ keep: external(), drop: external() });

    const result = run(used, config);

    expect(Object.keys(result.shared)).toEqual(['keep']);
  });

  it('always keeps deps flagged with includeSecondaries, even when unused', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig({ lib: external({ includeSecondaries: true }) });

    const result = run(used, config);

    expect(Object.keys(result.shared)).toEqual(['lib']);
  });

  it('preserves the meta object of retained dependencies', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const meta = external({ singleton: true, requiredVersion: '^1.0.0' });
    const config = makeConfig({ keep: meta });

    const result = run(used, config);

    expect(result.shared['keep']).toEqual(meta);
  });

  it('replaces sharedMappings with the used internal mappings', () => {
    const used: UsedDependencies = {
      external: new Set(),
      internal: { '/ws/libs/ui/index.ts': '@org/ui' },
    };
    const config = makeConfig({});

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
  });

  // Issue #100: a host that exposes almost nothing still has to advertise its catalog.
  it('keeps an opted-out mapping the reachability walk never reached', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' },
        sharedMappingsConfig: {
          '@org/ui': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true },
          },
        },
      }
    );

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
  });

  it('still prunes a mapping that did not opt out', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' },
        sharedMappingsConfig: { '@org/ui': { singleton: true, strictVersion: true } },
      }
    );

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({});
  });

  it('merges opted-out mappings with the reachable ones', () => {
    const used: UsedDependencies = {
      external: new Set(),
      internal: { '/ws/libs/reached/index.ts': '@org/reached' },
    };
    const config = makeConfig(
      {},
      {
        sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' },
        sharedMappingsConfig: {
          '@org/ui': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true },
          },
        },
      }
    );

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({
      '/ws/libs/ui/index.ts': '@org/ui',
      '/ws/libs/reached/index.ts': '@org/reached',
    });
  });

  // The whole point of resolveGlob: no reachability input at all, yet the catalog survives.
  it('expands a wildcard mapping from disk when resolveGlob is set', () => {
    const io = createMemoryIo()
      .setFile(path.join(WS, 'libs/ui/button/index.ts'), '')
      .setFile(path.join(WS, 'libs/ui/card/index.ts'), '');

    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { [path.join(WS, 'libs/ui/*/index.ts')]: '@org/ui/*' },
        sharedMappingsConfig: {
          '@org/ui/*': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true, resolveGlob: true },
          },
        },
      }
    );

    expect(run(used, config, io).sharedMappings).toEqual({
      [path.join(WS, 'libs/ui/button/index.ts')]: '@org/ui/button',
      [path.join(WS, 'libs/ui/card/index.ts')]: '@org/ui/card',
    });
  });

  it('warns when an expanded wildcard matches nothing on disk', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { [path.join(WS, 'libs/ui/*/index.ts')]: '@org/ui/*' },
        sharedMappingsConfig: {
          '@org/ui/*': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true, resolveGlob: true },
          },
        },
      }
    );

    expect(run(used, config).sharedMappings).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matched no files'));
  });

  // Without resolveGlob there is nothing that can turn the pattern into entry points.
  it('warns and prunes a wildcard mapping that opted out without resolveGlob', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { '/ws/libs/ui/*': '@org/ui/*' },
        sharedMappingsConfig: {
          '@org/ui/*': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true },
          },
        },
      }
    );

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@org/ui/*'));
  });

  // A bare `true` is a statement about secondary entry points, which a mapping does not have.
  it('ignores includeSecondaries: true on a mapping', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' },
        sharedMappingsConfig: {
          '@org/ui': { singleton: true, strictVersion: true, includeSecondaries: true },
        },
      }
    );

    expect(run(used, config).sharedMappings).toEqual({});
  });

  // The skip list only ever saw the raw pattern, so expanded imports must be re-checked.
  it('applies the skip list to expanded wildcard mappings', () => {
    const io = createMemoryIo()
      .setFile(path.join(WS, 'libs/ui/button/index.ts'), '')
      .setFile(path.join(WS, 'libs/ui/internal/index.ts'), '');

    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      {},
      {
        skip: prepareSkipList(['@org/ui/internal']),
        sharedMappings: { [path.join(WS, 'libs/ui/*/index.ts')]: '@org/ui/*' },
        sharedMappingsConfig: {
          '@org/ui/*': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: { keepAll: true, resolveGlob: true },
          },
        },
      }
    );

    expect(run(used, config, io).sharedMappings).toEqual({
      [path.join(WS, 'libs/ui/button/index.ts')]: '@org/ui/button',
    });
  });

  // Same gap on the reachability side: those imports are wildcard-substituted too.
  it('applies the skip list to reachability-resolved mappings', () => {
    const used: UsedDependencies = {
      external: new Set(),
      internal: {
        '/ws/libs/ui/button/index.ts': '@org/ui/button',
        '/ws/libs/ui/internal/index.ts': '@org/ui/internal',
      },
    };
    const config = makeConfig({}, { skip: prepareSkipList(['@org/ui/internal']) });

    expect(run(used, config).sharedMappings).toEqual({
      '/ws/libs/ui/button/index.ts': '@org/ui/button',
    });
  });

  it('does not mutate the original config', () => {
    const used: UsedDependencies = { external: new Set(['keep']), internal: {} };
    const config = makeConfig({ keep: external(), drop: external() });

    run(used, config);

    expect(Object.keys(config.shared)).toEqual(['keep', 'drop']);
  });

  it('leaves the rest of the config untouched', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig({});

    const result = run(used, config);

    expect(result.name).toBe('app');
    expect(result.$type).toBe('classic');
    expect(result.features).toEqual(config.features);
  });
});
