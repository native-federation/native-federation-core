import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';

// The two entry points must assemble remoteEntry.json identically; #109 was a field applied by
// one and not the other. Everything below the assembly layer is stubbed so only that logic runs.
vi.mock('../output/write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('../output/write-import-map.js', () => ({ writeImportMap: vi.fn() }));
vi.mock('./bundle-exposed-and-mappings.js', () => ({
  bundleExposedAndMappings: vi.fn(async () => undefined),
  describeExposed: vi.fn(() => [{ key: './Cmp', outFileName: 'cmp.js' }]),
  // Fresh objects on every call, exactly like the real implementation — so a default applied by
  // mutating cached externals cannot accidentally cover shared mappings too.
  describeSharedMappings: vi.fn((): SharedInfo[] => [
    {
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      version: '1.0.0',
      packageName: '@my/lib',
      outFileName: 'my-lib.js',
    },
  ]),
}));

const { buildForFederation } = await import('./build-for-federation.js');
const { rebuildForFederation } = await import('./rebuild-for-federation.js');

function flat(packageName: string, outFileName: string): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^21.0.0',
    version: '21.0.0',
    packageName,
    outFileName,
  };
}

// The shell's cache after bundling Angular: primary and secondary entry points side by side.
const seededExternals = (): SharedInfo[] => [
  flat('@angular/core', 'core.js'),
  flat('@angular/core/rxjs-interop', 'core-rxjs-interop.js'),
  flat('@angular/platform-browser', 'platform-browser.js'),
  flat('@angular/platform-browser/animations', 'platform-browser-animations.js'),
];

function makeConfig(
  overrides: {
    denseExternals?: boolean;
    integrityHashes?: boolean;
    shareScope?: string;
  } = {}
): NormalizedFederationConfig {
  return {
    $type: 'classic',
    name: 'shell',
    exposes: {},
    // Empty, so planSharedBundles yields nothing and the seeded cache stands in for a bundle run.
    shared: {},
    sharedMappings: {},
    sharedMappingsConfig: {},
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    ...(overrides.shareScope ? { shareScope: overrides.shareScope } : {}),
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals: overrides.denseExternals ?? false,
      integrityHashes: overrides.integrityHashes ?? false,
      synthesizeCjsExports: true,
    },
  };
}

function makeFedOptions(): NormalizedFederationOptions {
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    dev: true,
    federationConfig: 'federation.config.js',
    projectName: 'shell',
    entryPoints: [],
    cacheExternalArtifacts: false,
    federationCache: {
      externals: seededExternals(),
      chunks: { 'browser-shared': ['chunk-a.js'] },
      integrity: { 'core.js': 'sha384-cached' },
      bundlerCache: {},
      cachePath: '/cache',
    },
  };
}

const matrix = [
  { name: 'defaults', overrides: {} },
  { name: 'denseExternals', overrides: { denseExternals: true } },
  { name: 'shareScope', overrides: { shareScope: 'my-scope' } },
  { name: 'integrityHashes', overrides: { integrityHashes: true } },
  {
    name: 'denseExternals + shareScope',
    overrides: { denseExternals: true, shareScope: 'my-scope' },
  },
  {
    name: 'all features',
    overrides: { denseExternals: true, shareScope: 'my-scope', integrityHashes: true },
  },
] as const;

describe('buildForFederation / rebuildForFederation — assembly parity', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(matrix)('emits identical federation info with $name', async ({ overrides }) => {
    const built = await buildForFederation(makeConfig(overrides), makeFedOptions(), []);
    const rebuilt = await rebuildForFederation(makeConfig(overrides), makeFedOptions(), [], []);

    expect(rebuilt).toEqual(built);

    // Parity alone is satisfied by two identically broken paths, so pin the shape the flags ask
    // for. What each flag produces in detail is covered in the per-function specs.
    const dense = built.shared.every(s => 'entries' in s);
    expect(dense).toBe(!!overrides.denseExternals);
    if (overrides.shareScope) {
      expect(built.shared.every(s => s.shareScope === overrides.shareScope)).toBe(true);
    }
  });

  // A rebuild reuses the live fedOptions the initial build already touched, so parity has to
  // hold on that object too — not just on two pristine ones.
  it('stays identical when the rebuild reuses the fedOptions of the initial build', async () => {
    const config = makeConfig({ denseExternals: true, shareScope: 'my-scope' });
    const fedOptions = makeFedOptions();

    const built = await buildForFederation(config, fedOptions, []);
    const first = await rebuildForFederation(config, fedOptions, [], []);
    const second = await rebuildForFederation(config, fedOptions, [], []);

    expect(first).toEqual(built);
    expect(second).toEqual(built);
  });
});

describe('assembly — cached externals are not mutated', () => {
  beforeEach(() => vi.clearAllMocks());

  // shareScope used to be written onto the cached objects in place. That leaked the resolved
  // value into the cache, which is what made the rebuild gap look intermittent: npm externals
  // kept the scope from the initial build while freshly described mappings lost it.
  it('leaves federationCache.externals untouched when a shareScope default applies', async () => {
    const fedOptions = makeFedOptions();

    await buildForFederation(makeConfig({ shareScope: 'my-scope' }), fedOptions, []);

    expect(fedOptions.federationCache.externals).toEqual(seededExternals());
  });
});
