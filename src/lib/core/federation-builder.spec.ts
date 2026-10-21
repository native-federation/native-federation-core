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
