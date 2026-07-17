import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { SharedInfo } from '../../domain/core/federation-info.contract.js';

vi.mock('../output/write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('../output/write-import-map.js', () => ({ writeImportMap: vi.fn() }));
vi.mock('./bundle-exposed-and-mappings.js', () => ({
  bundleExposedAndMappings: vi.fn(async () => undefined),
  describeExposed: vi.fn(() => []),
  describeSharedMappings: vi.fn(() => []),
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

function config(): NormalizedFederationConfig {
  return {
    name: 'app',
    chunks: false,
    shared: {
      a: { platform: 'browser', build: 'default', chunks: false } as NormalizedExternalConfig,
    },
    features: {},
  } as unknown as NormalizedFederationConfig;
}

function fedOptions(externals: SharedInfo[]): NormalizedFederationOptions {
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    dev: true,
    federationConfig: 'federation.config.js',
    projectName: 'app',
    entryPoints: [],
    cacheExternalArtifacts: true,
    federationCache: { externals, bundlerCache: {}, cachePath: '/cache' },
  } as NormalizedFederationOptions;
}

describe('rebuildForFederation — affected-external re-bundling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-bundles and replaces externals when a modified file hits a shared package', async () => {
    vi.mocked(affectedSharedKeys).mockReturnValue(new Set(['a']));
    const stale: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.stale.js' } as SharedInfo];

    const info = await rebuildForFederation(config(), fedOptions(stale), ['a'], [
      '/dev/lib/dist/src/a.ts',
    ]);

    expect(executeSharedBundlePlans).toHaveBeenCalledOnce();
    expect(info.shared).toEqual([{ packageName: 'a', outFileName: 'a.fresh.js' }]);
  });

  it('reuses cached externals when no modified file hits a shared package', async () => {
    vi.mocked(affectedSharedKeys).mockReturnValue(new Set());
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];

    const info = await rebuildForFederation(config(), fedOptions(cached), ['a'], [
      '/unrelated/x.ts',
    ]);

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
