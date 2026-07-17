import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';

// Only the bundling leaf is mocked (it is nodeIo-bound and not port-injected);
// resolveSharedPackageDirs / affectedSharedKeys / cacheEntryCore all run for real
// against the injected memory-io, so this exercises the actual resolution path.
vi.mock('./build-for-federation.js', () => ({
  executeSharedBundlePlans: vi.fn(async (_plans, _config, fedOptions: NormalizedFederationOptions) => {
    fedOptions.federationCache.externals.push({
      packageName: 'a',
      outFileName: 'a.fresh.js',
    } as SharedInfo);
  }),
}));

const { rebuildAffectedExternals } = await import('./rebuild-for-federation.js');
const { executeSharedBundlePlans } = await import('./build-for-federation.js');

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
    federationCache: { externals, bundlerCache: {}, cachePath: '/cache' },
  } as NormalizedFederationOptions;
}

function repo(): PackageJsonRepository {
  return {
    findDepPackageJson: (name: string) =>
      name === 'a' ? '/ws/node_modules/a/package.json' : null,
    getPackageJsonFiles: () => [],
    readJson: () => ({}),
    exists: () => true,
  };
}

// Symlinked (npm-linked) shared package `a` → dev checkout at /dev/a.
const linkedIo = () =>
  createMemoryIo().setSymlink('/ws/node_modules/a', '/dev/a').setDir('/cache');

describe('rebuildAffectedExternals — port-injected resolution + invalidation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-bundles when a modified file resolves under a symlinked shared package', async () => {
    const fed = fedOptions([{ packageName: 'a', outFileName: 'a.stale.js' } as SharedInfo]);

    await rebuildAffectedExternals(config(), fed, ['a'], ['/dev/a/src/x.ts'], undefined, linkedIo(), repo());

    expect(executeSharedBundlePlans).toHaveBeenCalledOnce();
    expect(fed.federationCache.externals).toEqual([{ packageName: 'a', outFileName: 'a.fresh.js' }]);
  });

  it('reuses cached externals when the modified file is outside every shared dir', async () => {
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];
    const fed = fedOptions(cached);

    await rebuildAffectedExternals(config(), fed, ['a'], ['/unrelated/x.ts'], undefined, linkedIo(), repo());

    expect(executeSharedBundlePlans).not.toHaveBeenCalled();
    expect(fed.federationCache.externals).toEqual(cached);
  });

  it('is a no-op when no files changed', async () => {
    const cached: SharedInfo[] = [{ packageName: 'a', outFileName: 'a.cached.js' } as SharedInfo];
    const fed = fedOptions(cached);

    await rebuildAffectedExternals(config(), fed, ['a'], [], undefined, linkedIo(), repo());

    expect(executeSharedBundlePlans).not.toHaveBeenCalled();
    expect(fed.federationCache.externals).toEqual(cached);
  });
});
