import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SharedInfo, DenseSharedInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';

// Isolate the assembly logic in buildForFederation: no real FS writes, no build adapter.
vi.mock('../output/write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('../output/write-import-map.js', () => ({ writeImportMap: vi.fn() }));
vi.mock('./bundle-exposed-and-mappings.js', () => ({
  bundleExposedAndMappings: vi.fn(async () => undefined),
  describeExposed: vi.fn(() => []),
  describeSharedMappings: vi.fn(() => []),
}));

const { buildForFederation } = await import('./build-for-federation.js');
const { writeImportMap } = await import('../output/write-import-map.js');

function flat(packageName: string, outFileName: string, overrides: Partial<SharedInfo> = {}): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    version: '1.2.3',
    packageName,
    outFileName,
    ...overrides,
  };
}

function makeConfig(denseExternals: boolean): NormalizedFederationConfig {
  return {
    $type: 'classic',
    name: 'app',
    exposes: {},
    shared: {},
    sharedMappings: {},
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals,
      integrityHashes: false,
    },
  };
}

function makeFedOptions(externals: SharedInfo[]): NormalizedFederationOptions {
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    federationConfig: 'federation.config.js',
    projectName: 'app',
    entryPoints: [],
    cacheExternalArtifacts: false,
    federationCache: {
      externals,
      bundlerCache: {},
      cachePath: '/cache',
    },
  };
}

const seededExternals = (): SharedInfo[] => [
  flat('@angular/common', 'common.js'),
  flat('@angular/common/http', 'common-http.js'),
  flat('tslib', 'tslib.js'),
];

describe('buildForFederation — denseExternals wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves shared flat and unchanged when the flag is off', async () => {
    const externals = seededExternals();
    const info = await buildForFederation(makeConfig(false), makeFedOptions(externals), []);

    expect(info.shared).toEqual(externals);
    expect(info.shared.every(s => 'outFileName' in s && !('entries' in s))).toBe(true);
  });

  it('densifies shared when the flag is on', async () => {
    const info = await buildForFederation(makeConfig(true), makeFedOptions(seededExternals()), []);

    // @angular/common + secondary collapse into one dense object; tslib into another.
    expect(info.shared).toHaveLength(2);
    const [angular, tslib] = info.shared as [DenseSharedInfo, DenseSharedInfo];
    expect(angular.packageName).toBe('@angular/common');
    expect(angular.entries).toEqual({
      '@angular/common': 'common.js',
      '@angular/common/http': 'common-http.js',
    });
    expect(tslib.entries).toEqual({ tslib: 'tslib.js' });
    expect(info.shared.every(s => 'entries' in s && !('outFileName' in s))).toBe(true);
  });

  it('feeds writeImportMap the flat cache identically whether the flag is on or off', async () => {
    await buildForFederation(makeConfig(false), makeFedOptions(seededExternals()), []);
    const offArg = vi.mocked(writeImportMap).mock.calls[0]![0];

    vi.clearAllMocks();

    await buildForFederation(makeConfig(true), makeFedOptions(seededExternals()), []);
    const onArg = vi.mocked(writeImportMap).mock.calls[0]![0];

    // The import map is built from the flat federationCache, never from the (possibly dense)
    // federationInfo.shared — so its input is byte-identical regardless of denseExternals.
    expect(onArg.externals).toEqual(offArg.externals);
    expect(onArg.externals).toEqual(seededExternals());
    expect(onArg.externals.every(s => 'outFileName' in s && !('entries' in s))).toBe(true);
  });
});
