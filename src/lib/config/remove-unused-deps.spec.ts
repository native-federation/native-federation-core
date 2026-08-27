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

  // 'keepAll' is what puts includeSecondaries on the package AND on every secondary share-utils
  // discovered for it, so the flag is read per package family.
  describe('includeSecondaries (keepAll)', () => {
    it('keeps an unreached secondary of a package that is reached', () => {
      const used: UsedDependencies = { external: new Set(['@ng/core']), internal: {} };
      const config = makeConfig({
        '@ng/core': external({ includeSecondaries: true }),
        '@ng/core/rxjs-interop': external({ includeSecondaries: true }),
      });

      const result = run(used, config);

      expect(Object.keys(result.shared)).toEqual(['@ng/core', '@ng/core/rxjs-interop']);
    });

    it('keeps the package root when only a secondary is reached', () => {
      const used: UsedDependencies = {
        external: new Set(['@ng/core/rxjs-interop']),
        internal: {},
      };
      const config = makeConfig({
        '@ng/core': external({ includeSecondaries: true }),
        '@ng/core/rxjs-interop': external({ includeSecondaries: true }),
      });

      const result = run(used, config);

      expect(Object.keys(result.shared)).toEqual(['@ng/core', '@ng/core/rxjs-interop']);
    });

    // Without this, keepAll on every package turns ignoreUnusedDeps into a no-op.
    it('drops a whole family that nothing reaches', () => {
      const used: UsedDependencies = { external: new Set(['rxjs']), internal: {} };
      const config = makeConfig({
        rxjs: external({ includeSecondaries: true }),
        '@ng/core': external({ includeSecondaries: true }),
        '@ng/core/rxjs-interop': external({ includeSecondaries: true }),
      });

      const result = run(used, config);

      expect(Object.keys(result.shared)).toEqual(['rxjs']);
    });

    it('reads unscoped package families the same way', () => {
      const used: UsedDependencies = { external: new Set(['lodash/fp']), internal: {} };
      const config = makeConfig({
        lodash: external({ includeSecondaries: true }),
        'lodash/fp': external({ includeSecondaries: true }),
        moment: external({ includeSecondaries: true }),
      });

      const result = run(used, config);

      expect(Object.keys(result.shared)).toEqual(['lodash', 'lodash/fp']);
    });
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
            includeSecondaries: true,
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
            includeSecondaries: true,
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
            includeSecondaries: true,
            resolveGlob: true,
          },
        },
      }
    );

    expect(run(used, config, io).sharedMappings).toEqual({
      [path.join(WS, 'libs/ui/button/index.ts')]: '@org/ui/button',
      [path.join(WS, 'libs/ui/card/index.ts')]: '@org/ui/card',
    });
  });

  // The two sources are unioned, so reachability still contributes what expansion refused. That
  // is the mechanic, not an endorsement: a non-barrel specifier like this one is rejected later
  // by assertBarrelMappings — see normalize-options.spec.ts.
  it('lets reachability add a deep import that expansion refused', () => {
    const io = createMemoryIo()
      .setFile(path.join(WS, 'libs/ui/button/index.ts'), '')
      .setFile(path.join(WS, 'libs/ui/button/button.component.ts'), '');

    const used: UsedDependencies = {
      external: new Set(),
      internal: {
        [path.join(WS, 'libs/ui/button/button.component.ts')]: '@org/ui/button/button.component',
      },
    };
    const config = makeConfig(
      {},
      {
        sharedMappings: { [path.join(WS, 'libs/ui/*')]: '@org/ui/*' },
        sharedMappingsConfig: {
          '@org/ui/*': {
            singleton: true,
            strictVersion: true,
            includeSecondaries: true,
            resolveGlob: true,
          },
        },
      }
    );

    expect(run(used, config, io).sharedMappings).toEqual({
      [path.join(WS, 'libs/ui/button/index.ts')]: '@org/ui/button',
      [path.join(WS, 'libs/ui/button/button.component.ts')]: '@org/ui/button/button.component',
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
            includeSecondaries: true,
            resolveGlob: true,
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
            includeSecondaries: true,
          },
        },
      }
    );

    const result = run(used, config);

    expect(result.sharedMappings).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@org/ui/*'));
  });

  // The two halves read one normalized flag but act on it differently: a mapping opts out of
  // reachability entirely (issue #100 -- a host advertises a catalog it does not import itself),
  // while a shared external only opts its secondaries out of it.
  it('keeps an unreached mapping but not an unreached shared external', () => {
    const used: UsedDependencies = { external: new Set(), internal: {} };
    const config = makeConfig(
      { lib: external({ includeSecondaries: true }) },
      {
        sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' },
        sharedMappingsConfig: {
          '@org/ui': { singleton: true, strictVersion: true, includeSecondaries: true },
        },
      }
    );

    const result = run(used, config);

    expect(Object.keys(result.shared)).toEqual([]);
    expect(result.sharedMappings).toEqual({ '/ws/libs/ui/index.ts': '@org/ui' });
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
            includeSecondaries: true,
            resolveGlob: true,
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

  // angular-adapter#117 asked for exactly this signal: nine mappings, all pruned, nothing
  // failing. The spelling mismatch that is often the cause is reported from
  // resolveUsedMappings, which can name it — see get-used-dependencies.spec.ts.
  describe('all-mappings-pruned warning', () => {
    const allPruned = /No shared mapping is reachable/;

    it('warns when a non-empty mapping set is pruned to nothing', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const used: UsedDependencies = { external: new Set(), internal: {} };
      const config = makeConfig({}, { sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' } });

      expect(run(used, config).sharedMappings).toEqual({});
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(allPruned));
    });

    it('stays quiet when the config declared no mappings to begin with', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const used: UsedDependencies = { external: new Set(), internal: {} };

      run(used, makeConfig({}));

      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(allPruned));
    });

    it('stays quiet when at least one mapping survives', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const used: UsedDependencies = {
        external: new Set(),
        internal: { '/ws/libs/reached/index.ts': '@org/reached' },
      };
      const config = makeConfig({}, { sharedMappings: { '/ws/libs/ui/index.ts': '@org/ui' } });

      run(used, config);

      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(allPruned));
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
