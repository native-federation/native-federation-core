import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  SharedInfo,
  DenseSharedInfo,
  OutputFile,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { logger } from '../../utils/logger.js';
import type * as sharedDirs from './resolve-shared-dirs.js';
import type * as validation from '../output/validate-bare-imports.js';
import type { SharedBundleResult } from './bundle-shared.js';

// Isolate the assembly logic in buildForFederation: no real FS writes, no build adapter.
vi.mock('../output/write-federation-info.js', () => ({ writeFederationInfo: vi.fn() }));
vi.mock('../output/write-import-map.js', () => ({ writeImportMap: vi.fn() }));
vi.mock('./bundle-exposed-and-mappings.js', () => ({
  bundleExposedAndMappings: vi.fn(async () => ({ mappings: [], exposes: [], outputFiles: [] })),
}));

vi.mock('../output/validate-bare-imports.js', () => ({ validateBareImports: vi.fn() }));

// A full build replaces the cached externals with what its plans bundled, so each test seeds
// `bundled` (one plan per entry; a name starting with 'separate-' is a separate plan) instead of
// the cache.
let bundled: Record<string, SharedBundleResult | (() => Promise<SharedBundleResult>)> = {};
vi.mock('./shared-bundle-plan.js', () => ({
  planSharedBundles: vi.fn(() =>
    Object.keys(bundled).map(bundleName => ({
      kind: bundleName.startsWith('separate-') ? 'separate' : 'shared',
      bundleName,
      entries: {},
      externals: [],
      platform: 'browser',
      chunks: false,
      keys: [],
    }))
  ),
}));
vi.mock('./bundle-shared.js', () => ({
  bundleShared: vi.fn(async (_e, _c, _o, _x, { bundleName }) => {
    const result = bundled[bundleName]!;
    return typeof result === 'function' ? result() : result;
  }),
}));

vi.mock('../cache/cache-persistence.js', async importActual => ({
  ...(await importActual<object>()),
  prepareCache: vi.fn(),
}));

vi.mock('./resolve-shared-dirs.js', async importActual => ({
  ...(await importActual<typeof sharedDirs>()),
  hintUnwatchedLinkedDeps: vi.fn(),
}));

const { buildForFederation } = await import('./build-for-federation.js');
const { hintUnwatchedLinkedDeps } = await import('./resolve-shared-dirs.js');
const { writeImportMap } = await import('../output/write-import-map.js');
const { validateBareImports } = await import('../output/validate-bare-imports.js');
const { collectOutputFiles, externalsAreStale } = await import('../cache/federation-cache.js');
const { writeFederationInfo } = await import('../output/write-federation-info.js');
const { bundleExposedAndMappings } = await import('./bundle-exposed-and-mappings.js');

function flat(
  packageName: string,
  outFileName: string,
  overrides: Partial<SharedInfo> = {}
): SharedInfo {
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
    sharedMappingsConfig: {},
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals,
      integrityHashes: false,
      synthesizeCjsExports: true,
      strictImports: false,
    },
  };
}

function makeFedOptions(
  externals: SharedInfo[],
  overrides: Partial<NormalizedFederationOptions> = {}
): NormalizedFederationOptions {
  bundled = externals.length > 0 ? { 'browser-shared': { externals, outputFiles: [] } } : {};
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    federationConfig: 'federation.config.js',
    projectName: 'app',
    entryPoints: [],
    cacheExternalArtifacts: false,
    watchLinkedDeps: false,
    federationCache: {
      externals: [],
      bundlerCache: {},
      cachePath: '/cache',
    },
    ...overrides,
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

describe('buildForFederation — build notification endpoint', () => {
  const endpoint = '/nf:build-notifications';

  // Remotes advertise the endpoint through remoteEntry.json, so this gate is what
  // decides whether a consuming browser opens an event stream at all.
  async function buildWith(overrides: Partial<NormalizedFederationOptions>) {
    const info = await buildForFederation(
      makeConfig(false),
      makeFedOptions(seededExternals(), overrides),
      []
    );
    return info.buildNotificationsEndpoint;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the endpoint for an enabled dev build', async () => {
    expect(await buildWith({ dev: true, buildNotifications: { enable: true, endpoint } })).toBe(
      endpoint
    );
  });

  it('withholds the endpoint from a production build', async () => {
    expect(
      await buildWith({ dev: false, buildNotifications: { enable: true, endpoint } })
    ).toBeUndefined();
  });

  it('withholds the endpoint when notifications are disabled', async () => {
    expect(
      await buildWith({ dev: true, buildNotifications: { enable: false, endpoint } })
    ).toBeUndefined();
  });

  it('withholds the endpoint when notifications are unconfigured', async () => {
    expect(await buildWith({ dev: true })).toBeUndefined();
  });
});

// Adapters call buildForFederation and nothing else to start a session, so the hint has to
// be triggered here: an adapter that predates the option still gets the message, and none
// has to opt in. rebuildForFederation is a separate entry point and does not repeat it.
describe('buildForFederation — unwatched linked deps hint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hints once per build, with the config and options it was given', async () => {
    const config = makeConfig(false);
    const fedOptions = makeFedOptions(seededExternals(), { watch: true });

    await buildForFederation(config, fedOptions, []);

    expect(hintUnwatchedLinkedDeps).toHaveBeenCalledTimes(1);
    expect(hintUnwatchedLinkedDeps).toHaveBeenCalledWith(config, fedOptions);
  });
});

describe('buildForFederation — output files (core#177)', () => {
  beforeEach(() => vi.clearAllMocks());
  let workspaceRoot: string | undefined;
  afterEach(() => {
    vi.restoreAllMocks();
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  });

  it('hands validateBareImports every written file and records the same list', async () => {
    const external: OutputFile[] = [
      { fileName: 'tslib.js', platform: 'browser' },
      { fileName: 'node-lib.js', platform: 'node' },
    ];
    const artifacts: OutputFile[] = [
      { fileName: 'Comp.js', platform: 'browser' },
      { fileName: 'chunk-X.js', platform: 'browser' },
    ];
    vi.mocked(bundleExposedAndMappings).mockResolvedValueOnce({
      mappings: [],
      exposes: [],
      outputFiles: artifacts,
    });
    const config = makeConfig(false);
    const fedOptions = makeFedOptions([]);
    bundled = {
      'browser-shared': { externals: [], outputFiles: [external[0]!] },
      'node-lib': { externals: [], outputFiles: [external[1]!] },
    };

    const info = await buildForFederation(config, fedOptions, []);

    expect(validateBareImports).toHaveBeenCalledWith(config, fedOptions, info, [
      ...external,
      ...artifacts,
    ]);
    expect(collectOutputFiles(fedOptions.federationCache)).toEqual([...external, ...artifacts]);
  });

  // The validator runs unmocked here: a strict failure has to escape the build before
  // remoteEntry.json is written, or the host would load a remote that cannot resolve.
  it('fails with strictImports before remoteEntry.json is written', async () => {
    const actual = await vi.importActual<typeof validation>('../output/validate-bare-imports.js');
    vi.mocked(validateBareImports).mockImplementationOnce(actual.validateBareImports);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-strict-'));
    fs.mkdirSync(path.join(workspaceRoot, 'dist'));
    fs.writeFileSync(path.join(workspaceRoot, 'dist', 'Comp.js'), `import "@angular/common/http";`);
    vi.mocked(bundleExposedAndMappings).mockResolvedValueOnce({
      mappings: [],
      exposes: [],
      outputFiles: [{ fileName: 'Comp.js', platform: 'browser' }],
    });
    const config = makeConfig(false);
    config.features.strictImports = true;

    await expect(
      buildForFederation(config, makeFedOptions([], { workspaceRoot }), [])
    ).rejects.toThrow(/features\.strictImports/);
    expect(writeFederationInfo).not.toHaveBeenCalled();
  });
});

describe('buildForFederation — an aborted build', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the externals of the last complete build', async () => {
    const fedOptions = makeFedOptions([flat('react', 'react.js')]);
    await buildForFederation(makeConfig(false), fedOptions, []);

    bundled = {
      'browser-shared': { externals: [flat('vue', 'vue.js')], outputFiles: [] },
      'node-lib': { externals: [flat('fs-extra', 'fs-extra.js')], outputFiles: [] },
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildForFederation(makeConfig(false), fedOptions, [], controller.signal)
    ).rejects.toThrow(/After browser-shared bundle/);

    expect(fedOptions.federationCache.externals).toEqual([flat('react', 'react.js')]);
  });

  // An incomplete run makes the next rebuild re-run every plan, so a separate bundle that is still
  // running when its sibling fails would race that rebuild for the same bundle name.
  it('waits for every separate bundle before it rethrows a failed one', async () => {
    let slowFinished = false;
    const fedOptions = makeFedOptions([]);
    bundled = {
      'separate-fails': async () => {
        throw new Error('bundle failed');
      },
      'separate-slow': async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        slowFinished = true;
        return { externals: [flat('slow', 'slow.js')], outputFiles: [] };
      },
    };

    await expect(buildForFederation(makeConfig(false), fedOptions, [])).rejects.toThrow(
      'bundle failed'
    );

    expect(slowFinished).toBe(true);
    expect(externalsAreStale(fedOptions.federationCache)).toBe(true);
    expect(fedOptions.federationCache.externals).toEqual([]);
  });

  it('clears the incomplete mark once a run completes', async () => {
    const fedOptions = makeFedOptions([]);
    bundled = { 'separate-fails': async () => Promise.reject(new Error('bundle failed')) };
    await expect(buildForFederation(makeConfig(false), fedOptions, [])).rejects.toThrow();

    bundled = { 'browser-shared': { externals: [flat('react', 'react.js')], outputFiles: [] } };
    await buildForFederation(makeConfig(false), fedOptions, []);

    expect(externalsAreStale(fedOptions.federationCache)).toBe(false);
    expect(fedOptions.federationCache.externals).toEqual([flat('react', 'react.js')]);
  });
});
