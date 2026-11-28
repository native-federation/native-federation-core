import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type {
  DenseSharedInfo,
  FederationInfo,
} from '../../domain/core/federation-info.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';
import { createFederationCache } from '../cache/federation-cache.js';
import { createFakeBuildAdapter } from './__test-helpers__/fake-build-adapter.js';
import { setBuildAdapter } from './build-adapter.js';
import { buildForFederation } from './build-for-federation.js';
import { rebuildForFederation } from './rebuild-for-federation.js';
import { toChunkImport } from '../../domain/core/chunk.js';

// The real build path, unmocked from the plan to remoteEntry.json on disk: only the bundler is
// faked. It writes what esbuild would, relative `./chunk-*.js` imports between its own files, and
// core does the rest (rewriting to `@nf-internal/*`, renaming chunks by content, densify).
//
// Every expectation below is written by hand from the import graph of the fixture, never by
// lexing the output: a lexer-based oracle would repeat the implementation's walk and share its
// mistakes. Chunks core renames by content are looked up by a marker comment in their bytes.

let workspaceRoot: string;
let dist: string;

const CHART = '/pkgs/chart-lib/index.js';
const CHART_EXTRAS = '/pkgs/chart-lib/extras.js';
const TSLIB = '/pkgs/tslib/tslib.js';
const MY_LIB = 'libs/my-lib/index.ts';
const sourceOf = (file: string) => path.resolve(workspaceRoot, file);

// The bundler's output, per entry source file; chunk names carry an 8-character bundler hash.
const entryCode = (): Record<string, string> => ({
  [CHART]: `/* chart */ import './chunk-CHARTAAA.js'; export const lazy = () => import('./chunk-LAZYAAAA.js');`,
  [CHART_EXTRAS]: `/* extras */ import 'chart-lib'; import './chunk-EXTRASAA.js';`,
  [TSLIB]: `/* tslib */ import './chunk-TSLIBAAA.js';`,
  [MY_LIB]: `/* my-lib */ import './chunk-MYLIBAAA.js';`,
  [sourceOf('src/home.ts')]:
    `/* home */ import 'chart-lib'; import './chunk-HOMEAAAA.js'; export const route = () => import('./chunk-ROUTEAAA.js');`,
  [sourceOf('src/cart.ts')]: `/* cart */ import { s } from './chunk-SHAREDAA.js'; export { s };`,
});

const chunkCode: Record<string, Record<string, string>> = {
  'browser-shared': {
    'chunk-CHARTAAA.js': `/* chart-core */ import './chunk-CHARTBBB.js';`,
    'chunk-CHARTBBB.js': `/* chart-deep */ export {};`,
    'chunk-EXTRASAA.js': `/* extras-core */ export {};`,
    'chunk-LAZYAAAA.js': `/* chart-lazy */ export {};`,
    'chunk-TSLIBAAA.js': `/* tslib-core */ export {};`,
  },
  'mapping-bundle': {
    'chunk-MYLIBAAA.js': `/* my-lib-core */ export {};`,
  },
  'mapping-or-exposed': {
    'chunk-HOMEAAAA.js': `/* home-core */ import './chunk-SHAREDAA.js';`,
    'chunk-SHAREDAA.js': `/* exposed-shared */ export const s = 1;`,
    'chunk-ROUTEAAA.js': `/* home-route */ export {};`,
    // A source map and an asset are output files too, never chunks.
    'home.js.map': '{}',
    'styles.css': '',
  },
};

function bundlerAdapter() {
  const code = entryCode();
  const written = new Map<string, string>();
  const adapter = createFakeBuildAdapter({
    io: nodeIo,
    results: name => {
      const { options } = [...adapter.calls.setup].reverse().find(s => s.name === name)!;
      const files: Array<[string, string]> = [
        ...options.entryPoints.map(
          ep => [path.join(options.outdir, ep.outName), code[ep.fileName]!] as [string, string]
        ),
        ...Object.entries(chunkCode[name] ?? {}).map(
          ([file, text]) => [path.join(options.outdir, file), text] as [string, string]
        ),
      ];
      for (const [file, text] of files) written.set(file, text);
      return files.map(([fileName]) => ({ fileName }));
    },
    contents: fileName => written.get(fileName)!,
  });
  return adapter;
}

const shared = (entryPoint: string, overrides: Partial<NormalizedExternalConfig> = {}) => ({
  singleton: true,
  strictVersion: true,
  requiredVersion: '^1.0.0',
  version: '1.0.0',
  platform: 'browser' as const,
  build: 'default' as const,
  packageInfo: { entryPoint, version: '1.0.0', esm: true },
  ...overrides,
});

function makeConfig() {
  const config: NormalizedFederationConfig = {
    $type: 'classic',
    name: 'mfe',
    exposes: {
      './Home': { file: './src/home.ts' },
      './Cart': { file: './src/cart.ts' },
    },
    shared: {
      'chart-lib': shared(CHART, { preload: true }),
      'chart-lib/extras': shared(CHART_EXTRAS, { preload: true }),
      tslib: shared(TSLIB),
    },
    sharedMappings: { [MY_LIB]: 'my-lib' },
    sharedMappingsConfig: {},
    skip: prepareSkipList([]),
    chunks: true,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      integrityHashes: false,
      synthesizeCjsExports: false,
      // Fails the build on any bare import remoteEntry.json does not declare.
      strictImports: true,
      denseChunking: true,
      denseExternals: true,
    },
  };
  return config;
}

function makeFedOptions(cacheExternalArtifacts = false): NormalizedFederationOptions {
  return {
    workspaceRoot,
    outputPath: 'dist',
    federationConfig: 'federation.config.js',
    projectName: 'mfe',
    entryPoints: [],
    cacheExternalArtifacts,
    watchLinkedDeps: false,
    federationCache: createFederationCache(path.join(workspaceRoot, '.cache')),
  };
}

const EXTERNALS = ['chart-lib', 'chart-lib/extras', 'tslib'];

const readPublished = () =>
  JSON.parse(fs.readFileSync(path.join(dist, 'remoteEntry.json'), 'utf-8')) as FederationInfo;

async function build(fedOptions = makeFedOptions()) {
  const adapter = bundlerAdapter();
  setBuildAdapter(adapter);
  const returned = await buildForFederation(makeConfig(), fedOptions, EXTERNALS);
  return { returned, published: readPublished(), adapter };
}

// The published name of the one file in dist whose bytes carry `/* marker */`.
function fileWith(marker: string): string {
  const matches = fs
    .readdirSync(dist)
    .filter(file => /\.js$/.test(file))
    .filter(file => fs.readFileSync(path.join(dist, file), 'utf-8').includes(`/* ${marker} */`));
  expect(matches, marker).toHaveLength(1);
  return matches[0]!;
}

const exposedChunks = (info: FederationInfo) =>
  Object.fromEntries(info.exposes.map(e => [e.key, e.chunks]));

const record = (info: FederationInfo, packageName: string) =>
  info.shared.find(s => s.packageName === packageName) as DenseSharedInfo;

describe('buildForFederation — published chunk closures', () => {
  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-closures-'));
    dist = path.join(workspaceRoot, 'dist');
    fs.mkdirSync(dist);
    for (const level of ['info', 'notice', 'measure', 'warn'] as const) {
      vi.spyOn(logger, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  // The entries import `@nf-internal/*`, while chunk-to-chunk imports stay relative; both resolve,
  // and chunks are renamed by content.
  it('lists the dense chunks of each exposed module', async () => {
    const { published } = await build();
    const row = (marker: string, initial: boolean) => {
      const file = fileWith(marker);
      return [toChunkImport(file), initial ? { file, initial } : { file }];
    };

    expect(fs.readFileSync(path.join(dist, 'Home.js'), 'utf-8')).toContain('@nf-internal/chunk-');
    expect(exposedChunks(published)).toEqual({
      './Home': Object.fromEntries([
        row('home-core', true),
        row('exposed-shared', true),
        row('home-route', false),
      ]),
      './Cart': Object.fromEntries([row('exposed-shared', true)]),
    });
    expect(fileWith('home-core')).not.toBe('chunk-HOMEAAAA.js');
  });

  // A preload package's chunks are those of its bundle, listed once in top-level `chunks`.
  it('publishes no chunk list on shared records', async () => {
    const { published } = await build();

    for (const record of published.shared) expect(record).not.toHaveProperty('chunks');
  });

  it("lists a preload package's chunks under its bundle", async () => {
    const { published } = await build();

    const bundle = record(published, 'chart-lib').bundle!;
    expect(published.chunks?.[bundle]).toEqual(
      expect.arrayContaining([
        fileWith('chart-core'),
        fileWith('chart-deep'),
        fileWith('extras-core'),
      ])
    );
  });

  it('publishes preload only on the packages configured with it', async () => {
    const { published } = await build();

    expect(record(published, 'chart-lib').preload).toBe(true);
    expect(record(published, 'tslib')).not.toHaveProperty('preload');
  });

  it('keeps a dense preload record one record, without a list of its own', async () => {
    const { published } = await build();

    const chartLib = published.shared.filter(s => s.packageName === 'chart-lib');
    expect(chartLib).toHaveLength(1);
    expect(chartLib[0]).toMatchObject({
      preload: true,
      entries: {
        'chart-lib': fileWith('chart'),
        'chart-lib/extras': fileWith('extras'),
      },
    } satisfies Partial<DenseSharedInfo>);
    expect(chartLib[0]).not.toHaveProperty('chunks');
  });

  // The whole wire format a runtime reads: shared packages, a mapping, exposed modules and split
  // chunks, written out by hand (no snapshot file) so a format change shows up as an edit to this
  // row. Chunk names are content hashes, so they only move when the fixture's bytes do.
  it('writes remoteEntry.json', async () => {
    const { published } = await build();

    expect(published).toEqual({
      $version: 'v5',
      name: 'mfe',
      chunks: {
        'browser-shared': [
          'chunk-QTDORPIU.js',
          'chunk-3CNQCWNB.js',
          'chunk-SDY535X5.js',
          'chunk-OCDHTTJP.js',
          'chunk-3JS3MFFU.js',
        ],
        'mapping-bundle': ['chunk-4A5BQSGU.js'],
        'mapping-or-exposed': ['chunk-E4LY4AS4.js', 'chunk-O4YEPRQO.js', 'chunk-MV6JVKWS.js'],
      },
      exposes: [
        {
          key: './Home',
          outFileName: 'Home.js',
          chunks: {
            '@nf-internal/chunk-E4LY4AS4': { file: 'chunk-E4LY4AS4.js', initial: true },
            '@nf-internal/chunk-O4YEPRQO': { file: 'chunk-O4YEPRQO.js', initial: true },
            '@nf-internal/chunk-MV6JVKWS': { file: 'chunk-MV6JVKWS.js' },
          },
        },
        {
          key: './Cart',
          outFileName: 'Cart.js',
          chunks: {
            '@nf-internal/chunk-O4YEPRQO': { file: 'chunk-O4YEPRQO.js', initial: true },
          },
        },
      ],
      shared: [
        {
          packageName: 'chart-lib',
          bundle: 'browser-shared',
          entries: {
            'chart-lib': 'chart_lib.D2XIoLh0XZ.js',
            'chart-lib/extras': 'chart_lib_extras.GeNvxeJbTq.js',
          },
          preload: true,
          requiredVersion: '^1.0.0',
          singleton: true,
          strictVersion: true,
          version: '1.0.0',
        },
        {
          packageName: 'tslib',
          bundle: 'browser-shared',
          entries: { tslib: 'tslib.iAWSpLA311.js' },
          requiredVersion: '^1.0.0',
          singleton: true,
          strictVersion: true,
          version: '1.0.0',
        },
        {
          packageName: 'my-lib',
          bundle: 'mapping-bundle',
          entries: { 'my-lib': 'my_lib.js' },
          requiredVersion: '',
          singleton: true,
          strictVersion: false,
          version: '',
        },
      ],
    });
  });

  // A cache hit skips the adapter for shared bundles, so everything published about them comes from
  // the cache entry and the files it copies back.
  it('publishes the same remoteEntry.json from a warm shared cache', async () => {
    const cold = await build(makeFedOptions(true));
    fs.rmSync(dist, { recursive: true });
    fs.mkdirSync(dist);

    const warm = await build(makeFedOptions(true));

    expect(warm.adapter.calls.setup.map(s => s.name)).not.toContain('browser-shared');
    expect(warm.published).toEqual(cold.published);
  });

  // A different layout under the same minor purges the cache, so the next build is cold again.
  it('publishes the same remoteEntry.json after a cache layout purge', async () => {
    const cold = await build(makeFedOptions(true));
    const stampFile = path.join(workspaceRoot, '.cache', '.nf-cache.json');
    const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf-8'));
    fs.writeFileSync(stampFile, JSON.stringify({ ...stamp, layout: stamp.layout - 1 }));
    fs.rmSync(dist, { recursive: true });
    fs.mkdirSync(dist);

    const purged = await build(makeFedOptions(true));

    expect(purged.adapter.calls.setup.map(s => s.name)).toContain('browser-shared');
    expect(purged.published).toEqual(cold.published);
  });

  // A watch rebuild re-runs the exposed and mapping bundles and keeps the shared ones.
  it('publishes the same remoteEntry.json after a watch rebuild', async () => {
    const fedOptions = makeFedOptions();
    const fresh = await build(fedOptions);

    await rebuildForFederation(makeConfig(), fedOptions, EXTERNALS, [sourceOf('src/home.ts')]);

    expect(readPublished()).toEqual(fresh.published);
  });

  it('returns what it publishes', async () => {
    const { returned, published } = await build();

    expect(JSON.parse(JSON.stringify({ $version: 'v5', ...returned }))).toEqual(published);
  });
});
