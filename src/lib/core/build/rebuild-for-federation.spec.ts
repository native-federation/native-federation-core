import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { DenseSharedInfo, SharedInfo } from '../../domain/core/federation-info.contract.js';

vi.mock('../output/write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('../output/write-import-map.js', () => ({ writeImportMap: vi.fn() }));
vi.mock('./bundle-exposed-and-mappings.js', () => ({
  bundleExposedAndMappings: vi.fn(async () => ({ mappings: [], exposes: [] })),
}));
vi.mock('../cache/cache-persistence.js', () => ({
  cacheEntryCore: vi.fn(() => ({ clear: vi.fn() })),
  getFilename: vi.fn((name: string) => `${name}.meta.json`),
}));
vi.mock('./resolve-shared-dirs.js', () => ({
  resolveSharedPackageDirs: vi.fn(() => new Map()),
  affectedSharedKeys: vi.fn(),
}));
vi.mock('./build-for-federation.js', () => ({
  executeSharedBundlePlans: vi.fn(async (_plans, _config, fedOptions) => {
    fedOptions.federationCache.externals.push({ packageName: 'a', outFileName: 'a.fresh.js' });
  }),
}));

const { rebuildForFederation } = await import('./rebuild-for-federation.js');
const { executeSharedBundlePlans } = await import('./build-for-federation.js');
const { affectedSharedKeys } = await import('./resolve-shared-dirs.js');
const { bundleExposedAndMappings } = await import('./bundle-exposed-and-mappings.js');

// Fresh objects per call, like the real implementation, so a shareScope default written in place
// cannot survive from one rebuild into the next.
const mappingsPerCall = (mappings: () => SharedInfo[]) =>
  vi.mocked(bundleExposedAndMappings).mockImplementation(async () => ({
    mappings: mappings(),
    exposes: [],
  }));

function config(
  overrides: { denseExternals?: boolean; shareScope?: string } = {}
): NormalizedFederationConfig {
  return {
    name: 'app',
    chunks: false,
    shared: {
      a: { platform: 'browser', build: 'default', chunks: false } as NormalizedExternalConfig,
    },
    ...(overrides.shareScope ? { shareScope: overrides.shareScope } : {}),
    features: { denseExternals: overrides.denseExternals ?? false },
  } as unknown as NormalizedFederationConfig;
}

function fedOptions(
  externals: SharedInfo[],
  overrides: Partial<NormalizedFederationOptions> = {}
): NormalizedFederationOptions {
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    dev: true,
    federationConfig: 'federation.config.js',
    projectName: 'app',
    entryPoints: [],
    cacheExternalArtifacts: true,
    federationCache: { externals, bundlerCache: {}, cachePath: '/cache' },
    ...overrides,
  } as NormalizedFederationOptions;
}

describe('rebuildForFederation — affected-external re-bundling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-bundles and replaces externals when a modified file hits a shared package', async () => {
    vi.mocked(affectedSharedKeys).mockReturnValue(new Set(['a']));
    const stale: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.stale.js' } as SharedInfo];

    const info = await rebuildForFederation(
      config(),
      fedOptions(stale),
      ['a'],
      ['/dev/lib/dist/src/a.ts']
    );

    expect(executeSharedBundlePlans).toHaveBeenCalledOnce();
    expect(info.shared).toEqual([{ packageName: 'a', outFileName: 'a.fresh.js' }]);
  });

  it('reuses cached externals when no modified file hits a shared package', async () => {
    vi.mocked(affectedSharedKeys).mockReturnValue(new Set());
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];

    const info = await rebuildForFederation(
      config(),
      fedOptions(cached),
      ['a'],
      ['/unrelated/x.ts']
    );

    expect(executeSharedBundlePlans).not.toHaveBeenCalled();
    expect(info.shared).toEqual(cached);
  });

  it('skips detection entirely when no files changed', async () => {
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];

    await rebuildForFederation(config(), fedOptions(cached), ['a'], []);

    expect(affectedSharedKeys).not.toHaveBeenCalled();
    expect(executeSharedBundlePlans).not.toHaveBeenCalled();
  });
});

// Issue #109: a rebuild that emitted flat entries while the remotes stayed dense let a secondary
// entry point (e.g. @angular/core/rxjs-interop) resolve to a different provider than its primary,
// loading Angular twice.
describe('rebuildForFederation — denseExternals', () => {
  const angular = (): SharedInfo[] =>
    [
      { packageName: '@angular/core', outFileName: 'core.js', version: '21.0.0', singleton: true },
      {
        packageName: '@angular/core/rxjs-interop',
        outFileName: 'core-rxjs-interop.js',
        version: '21.0.0',
        singleton: true,
      },
    ] as SharedInfo[];

  beforeEach(() => {
    vi.clearAllMocks();
    mappingsPerCall(() => []);
  });

  it('groups secondary entry points under their parent package when the flag is on', async () => {
    const info = await rebuildForFederation(
      config({ denseExternals: true }),
      fedOptions(angular()),
      ['@angular/core'],
      []
    );

    expect(info.shared).toHaveLength(1);
    const [core] = info.shared as [DenseSharedInfo];
    expect(core.packageName).toBe('@angular/core');
    expect(core.entries).toEqual({
      '@angular/core': 'core.js',
      '@angular/core/rxjs-interop': 'core-rxjs-interop.js',
    });
  });

  it('leaves shared flat when the flag is off', async () => {
    const externals = angular();
    const info = await rebuildForFederation(config(), fedOptions(externals), ['@angular/core'], []);

    expect(info.shared).toEqual(externals);
  });

  it('stays stable across consecutive rebuilds on the same fedOptions', async () => {
    const options = fedOptions(angular());
    const first = await rebuildForFederation(
      config({ denseExternals: true }),
      options,
      ['@angular/core'],
      []
    );
    const second = await rebuildForFederation(
      config({ denseExternals: true }),
      options,
      ['@angular/core'],
      []
    );

    expect(second).toEqual(first);
  });
});

describe('rebuildForFederation — shareScope default', () => {
  beforeEach(() => vi.clearAllMocks());

  // The mock re-describes mappings per call, like the real one, so a default that only reached the
  // (long-lived) cached externals would leave this one bare.
  it('applies the configured scope to cached externals and freshly described mappings', async () => {
    mappingsPerCall(() => [{ packageName: '@my/lib', outFileName: 'my-lib.js' } as SharedInfo]);
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];

    const info = await rebuildForFederation(
      config({ shareScope: 'my-scope' }),
      fedOptions(cached),
      ['a'],
      []
    );

    expect(info.shared.map(s => [s.packageName, s.shareScope])).toEqual([
      ['a', 'my-scope'],
      ['@my/lib', 'my-scope'],
    ]);
  });

  it('keeps an explicit per-external scope', async () => {
    mappingsPerCall(() => []);
    const cached: SharedInfo[] = [
      { packageName: 'a', outFileName: 'a.cached.js', shareScope: 'own-scope' } as SharedInfo,
    ];

    const info = await rebuildForFederation(
      config({ shareScope: 'my-scope' }),
      fedOptions(cached),
      ['a'],
      []
    );

    expect(info.shared[0]!.shareScope).toBe('own-scope');
  });
});

describe('rebuildForFederation — build notification endpoint', () => {
  const endpoint = '/nf:build-notifications';

  // A rebuild rewrites remoteEntry.json, so it has to reach the same verdict as the
  // initial build or a watch would publish or retract the endpoint behind the app's back.
  async function rebuildWith(overrides: Partial<NormalizedFederationOptions>) {
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];
    const info = await rebuildForFederation(config(), fedOptions(cached, overrides), ['a'], []);
    return info.buildNotificationsEndpoint;
  }

  beforeEach(() => vi.clearAllMocks());

  it('publishes the endpoint for an enabled dev rebuild', async () => {
    expect(await rebuildWith({ dev: true, buildNotifications: { enable: true, endpoint } })).toBe(
      endpoint
    );
  });

  it('withholds the endpoint from a production rebuild', async () => {
    expect(
      await rebuildWith({ dev: false, buildNotifications: { enable: true, endpoint } })
    ).toBeUndefined();
  });

  it('withholds the endpoint when notifications are disabled', async () => {
    expect(
      await rebuildWith({ dev: true, buildNotifications: { enable: false, endpoint } })
    ).toBeUndefined();
  });

  it('withholds the endpoint when notifications are unconfigured', async () => {
    expect(await rebuildWith({ dev: true })).toBeUndefined();
  });
});
