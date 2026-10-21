import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NFBuildAdapter } from '../domain/core/build-adapter.contract.js';
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import { createFederationCache } from './cache/federation-cache.js';

// The builder is the only stateful entry point; normalize and the build itself are mocked so the
// getter is tested against the cache shape a real build leaves behind.
vi.mock('./normalize-options.js', () => ({
  normalizeFederationOptions: vi.fn(async () => ({
    config: { shared: {}, sharedMappings: {}, externals: [] },
    options: { federationCache: createFederationCache('/cache') },
  })),
}));
vi.mock('./build/build-for-federation.js', () => ({
  buildForFederation: vi.fn(async (_config, fedOptions) => {
    fedOptions.federationCache.externalFiles = {
      'browser-shared': [{ fileName: 'react.js', platform: 'browser' }],
    };
    fedOptions.federationCache.artifactFiles = [{ fileName: 'Component.js', platform: 'browser' }];
    return { name: 'mfe1', exposes: [], shared: [] };
  }),
}));
vi.mock('./build/rebuild-for-federation.js', () => ({
  rebuildForFederation: vi.fn(async () => ({ name: 'mfe1', exposes: [], shared: [] })),
}));

const adapter = { setup: vi.fn(), build: vi.fn(), dispose: vi.fn() } as unknown as NFBuildAdapter;

describe('federationBuilder.outputFiles (core#177)', () => {
  beforeEach(() => vi.resetModules());

  it('is undefined before init', async () => {
    const { federationBuilder } = await import('./federation-builder.js');
    expect(federationBuilder.outputFiles).toBeUndefined();
  });

  it('lists the shared and the mapping/exposed files after a build', async () => {
    const { federationBuilder } = await import('./federation-builder.js');
    await federationBuilder.init({ options: {} as FederationOptions, adapter });
    await federationBuilder.build();

    expect(federationBuilder.outputFiles).toEqual([
      { fileName: 'react.js', platform: 'browser' },
      { fileName: 'Component.js', platform: 'browser' },
    ]);
  });
});

describe('federationBuilder.init', () => {
  beforeEach(() => vi.resetModules());

  it("passes the adapter's externals to normalize", async () => {
    const { federationBuilder } = await import('./federation-builder.js');
    const { normalizeFederationOptions } = await import('./normalize-options.js');
    const options = {} as FederationOptions;

    await federationBuilder.init({ options, adapter: { ...adapter, externals: ['@vite/client'] } });

    expect(normalizeFederationOptions).toHaveBeenLastCalledWith(options, undefined, {
      externals: ['@vite/client'],
    });
  });
});

// A second init normalizes into a fresh FederationCache. Rebuilding on it publishes no shared
// externals (nothing is marked modified, so the shared bundles never run) and skips setup(), so a
// fresh adapter fails and the same adapter rebuilds its old context.
describe('federationBuilder after a second init', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('runs a full build on the cache the second init normalized', async () => {
    const { federationBuilder } = await import('./federation-builder.js');
    const { normalizeFederationOptions } = await import('./normalize-options.js');
    const { buildForFederation } = await import('./build/build-for-federation.js');
    const { rebuildForFederation } = await import('./build/rebuild-for-federation.js');
    const params = { options: {} as FederationOptions, adapter };

    await federationBuilder.init(params);
    await federationBuilder.build();
    await federationBuilder.build({ modifiedFiles: ['/ws/src/a.ts'] });
    await federationBuilder.init(params);
    await federationBuilder.build();

    expect(buildForFederation).toHaveBeenCalledTimes(2);
    expect(rebuildForFederation).toHaveBeenCalledTimes(1);
    const second = await vi.mocked(normalizeFederationOptions).mock.results[1]!.value;
    expect(vi.mocked(buildForFederation).mock.calls[1]![1].federationCache).toBe(
      second.options.federationCache
    );
  });

  // A dev server that re-inits on a config change can do so while its first build still runs.
  it('runs a full build when init ran during the previous full build', async () => {
    const { federationBuilder } = await import('./federation-builder.js');
    const { buildForFederation } = await import('./build/build-for-federation.js');
    const { rebuildForFederation } = await import('./build/rebuild-for-federation.js');
    const params = { options: {} as FederationOptions, adapter };
    let finishFirstBuild!: () => void;
    vi.mocked(buildForFederation).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishFirstBuild = () => resolve({ name: 'mfe1', exposes: [], shared: [] });
        })
    );

    await federationBuilder.init(params);
    const firstBuild = federationBuilder.build();
    await federationBuilder.init(params);
    finishFirstBuild();
    await firstBuild;
    await federationBuilder.build();

    expect(buildForFederation).toHaveBeenCalledTimes(2);
    expect(rebuildForFederation).not.toHaveBeenCalled();
  });
});
