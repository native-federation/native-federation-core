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
const TINY = '/pkgs/tiny-lib/index.js';
const MY_LIB = 'libs/my-lib/index.ts';
const sourceOf = (file: string) => path.resolve(workspaceRoot, file);

// The bundler's output, per entry source file; chunk names carry an 8-character bundler hash.
const entryCode = (): Record<string, string> => ({
  [CHART]: `/* chart */ import './chunk-CHARTAAA.js'; export const lazy = () => import('./chunk-LAZYAAAA.js');`,
  // import.meta is no import, so it adds nothing to the closure.
  [CHART_EXTRAS]: `/* extras */ import 'chart-lib'; import './chunk-EXTRASAA.js'; export const url = import.meta.url;`,
  [TSLIB]: `/* tslib */ import './chunk-TSLIBAAA.js'; import './chunk-COMMONAA.js';`,
  [TINY]: `/* tiny */ export {};`,
  [MY_LIB]: `/* my-lib */ import './chunk-MYLIBAAA.js';`,
  [sourceOf('src/home.ts')]:
    `/* home */ import 'chart-lib'; import './chunk-HOMEAAAA.js'; export const route = () => import('./chunk-ROUTEAAA.js');`,
  [sourceOf('src/cart.ts')]:
    `/* cart */ import { s } from './chunk-SHAREDAA.js'; import './chunk-COMMONAA.js'; export { s };`,
});

// The chunks a bundle emits for each of its entries. A bundle holding several entries emits the
// union, so where an entry is built decides nothing about which chunks it reaches.
const chunksOf = (): Record<string, Record<string, string>> => ({
  [CHART]: {
    'chunk-CHARTAAA.js': `/* chart-core */ import './chunk-CHARTBBB.js';`,
    // A relative import() between chunks: reached, but not initially.
    'chunk-CHARTBBB.js': `/* chart-deep */ export const later = () => import('./chunk-DEEPLAZY.js');`,
    'chunk-DEEPLAZY.js': `/* chart-deep-lazy */ export {};`,
    'chunk-LAZYAAAA.js': `/* chart-lazy */ export {};`,
  },
  [CHART_EXTRAS]: { 'chunk-EXTRASAA.js': `/* extras-core */ export {};` },
  [TSLIB]: {
    'chunk-TSLIBAAA.js': `/* tslib-core */ export {};`,
    // The same bytes as the exposed build's copy, so content naming gives both one file.
    'chunk-COMMONAA.js': `/* common */ export {};`,
  },
  [MY_LIB]: { 'chunk-MYLIBAAA.js': `/* my-lib-core */ export {};` },
  [sourceOf('src/home.ts')]: {
    'chunk-HOMEAAAA.js': `/* home-core */ import './chunk-SHAREDAA.js';`,
    'chunk-SHAREDAA.js': `/* exposed-shared */ export const s = 1;`,
    'chunk-ROUTEAAA.js': `/* home-route */ export {};`,
    // A source map and an asset are output files too, never chunks.
    'home.js.map': '{}',
    'styles.css': '',
  },
  [sourceOf('src/cart.ts')]: {
    'chunk-SHAREDAA.js': `/* exposed-shared */ export const s = 1;`,
    'chunk-COMMONAA.js': `/* common */ export {};`,
  },
});

function bundlerAdapter() {
  const code = entryCode();
  const chunks = chunksOf();
  const written = new Map<string, string>();
  const adapter = createFakeBuildAdapter({
    io: nodeIo,
    results: name => {
      const { options } = [...adapter.calls.setup].reverse().find(s => s.name === name)!;
      const files = new Map<string, string>();
      for (const ep of options.entryPoints) {
        files.set(path.join(options.outdir, ep.outName), code[ep.fileName]!);
        for (const [file, text] of Object.entries(chunks[ep.fileName] ?? {})) {
          files.set(path.join(options.outdir, file), text);
        }
      }
      for (const [file, text] of files) written.set(file, text);
      return [...files.keys()].map(fileName => ({ fileName }));
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
      'tiny-lib': shared(TINY),
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

const EXTERNALS = ['chart-lib', 'chart-lib/extras', 'tslib', 'tiny-lib'];

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

const row = (marker: string, initial: boolean) => {
  const file = fileWith(marker);
  return [toChunkImport(file), initial ? { file, initial } : { file }];
};

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

    expect(fs.readFileSync(path.join(dist, 'Home.js'), 'utf-8')).toContain('@nf-internal/chunk-');
    expect(exposedChunks(published)).toEqual({
      './Home': Object.fromEntries([
        row('home-core', true),
        row('exposed-shared', true),
        row('home-route', false),
      ]),
      './Cart': Object.fromEntries([row('exposed-shared', true), row('common', true)]),
    });
    expect(fileWith('home-core')).not.toBe('chunk-HOMEAAAA.js');
  });

  // chart-lib/extras is a second entry: initial is the union of both entries' static closures, and
  // a chunk only an import() reaches, directly or from inside another chunk, is listed without it.
  it('lists the chunks each shared record reaches from all of its entries', async () => {
    const { published } = await build();

    expect(record(published, 'chart-lib').chunks).toEqual(
      Object.fromEntries([
        row('chart-core', true),
        row('chart-deep', true),
        row('extras-core', true),
        row('chart-lazy', false),
        row('chart-deep-lazy', false),
      ])
    );
  });

  it('lists the chunks of a mapping record', async () => {
    const { published } = await build();

    expect(record(published, 'my-lib').chunks).toEqual(
      Object.fromEntries([row('my-lib-core', true)])
    );
  });

  it('lists a chunk an exposed module and a shared record both reach in both maps', async () => {
    const { published } = await build();
    const [key, entry] = row('common', true);

    expect(record(published, 'tslib').chunks).toHaveProperty([key as string], entry);
    expect(published.exposes.find(e => e.key === './Cart')!.chunks).toHaveProperty(
      [key as string],
      entry
    );
  });

  it('writes initial only as true and omits an empty map', async () => {
    const { published } = await build();

    expect(record(published, 'tiny-lib')).not.toHaveProperty('chunks');
    expect(JSON.stringify(published)).not.toContain('"initial":false');
  });

  // Each record lists its own chunks, so a bundle name or a list per bundle has nothing to add.
  it('publishes no top-level chunks, no bundle and no chunk record', async () => {
    const { published } = await build();

    expect(published).not.toHaveProperty('chunks');
    for (const shared of published.shared) {
      expect(shared).not.toHaveProperty('bundle');
      expect(shared).not.toHaveProperty('outFileName');
      expect(shared.packageName).not.toMatch(/^@nf-internal\//);
    }
  });

  it('publishes preload only on the packages configured with it', async () => {
    const { published } = await build();

    expect(record(published, 'chart-lib').preload).toBe(true);
    expect(record(published, 'tslib')).not.toHaveProperty('preload');
  });

  // A package built in two bundles is still one record; its map covers what both bundles emitted.
  it('lists the chunks of both bundles on a package split across them', async () => {
    const config = makeConfig();
    config.shared['chart-lib/extras'] = shared(CHART_EXTRAS, { preload: true, build: 'separate' });
    const adapter = bundlerAdapter();
    setBuildAdapter(adapter);

    await buildForFederation(config, makeFedOptions(), EXTERNALS);
    const published = readPublished();

    expect(new Set(adapter.calls.setup.map(s => s.name)).size).toBe(4);
    expect(published.shared.filter(s => s.packageName === 'chart-lib')).toHaveLength(1);
    expect(record(published, 'chart-lib').chunks).toEqual(
      Object.fromEntries([
        row('chart-core', true),
        row('chart-deep', true),
        row('extras-core', true),
        row('chart-lazy', false),
        row('chart-deep-lazy', false),
      ])
    );
  });

  // The whole wire format a runtime reads: shared packages, a mapping, exposed modules and split
  // chunks, written out by hand (no snapshot file) so a format change shows up as an edit to this
  // row. Chunk names are content hashes, so they only move when the fixture's bytes do.
  it('writes remoteEntry.json', async () => {
    const { published } = await build();

    expect(published).toEqual({
      $version: 'v5',
      name: 'mfe',
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
            '@nf-internal/chunk-U2RE6XH5': { file: 'chunk-U2RE6XH5.js', initial: true },
          },
        },
      ],
      shared: [
        {
          packageName: 'chart-lib',
          entries: {
            'chart-lib': 'chart_lib.v4lmJQaLRT.js',
            'chart-lib/extras': 'chart_lib_extras.1EbMVlnLBX.js',
          },
          chunks: {
            '@nf-internal/chunk-3KTDL4MO': { file: 'chunk-3KTDL4MO.js', initial: true },
            '@nf-internal/chunk-AR7ZSCZJ': { file: 'chunk-AR7ZSCZJ.js', initial: true },
            '@nf-internal/chunk-E4TBSRPU': { file: 'chunk-E4TBSRPU.js' },
            '@nf-internal/chunk-OCDHTTJP': { file: 'chunk-OCDHTTJP.js' },
            '@nf-internal/chunk-SDY535X5': { file: 'chunk-SDY535X5.js', initial: true },
          },
          preload: true,
          requiredVersion: '^1.0.0',
          singleton: true,
          strictVersion: true,
          version: '1.0.0',
        },
        {
          packageName: 'tslib',
          entries: { tslib: 'tslib.A6K4Jc0jY_.js' },
          chunks: {
            '@nf-internal/chunk-3JS3MFFU': { file: 'chunk-3JS3MFFU.js', initial: true },
            '@nf-internal/chunk-U2RE6XH5': { file: 'chunk-U2RE6XH5.js', initial: true },
          },
          requiredVersion: '^1.0.0',
          singleton: true,
          strictVersion: true,
          version: '1.0.0',
        },
        {
          packageName: 'tiny-lib',
          entries: { 'tiny-lib': 'tiny_lib.QshXFIwIMs.js' },
          requiredVersion: '^1.0.0',
          singleton: true,
          strictVersion: true,
          version: '1.0.0',
        },
        {
          packageName: 'my-lib',
          entries: { 'my-lib': 'my_lib.js' },
          chunks: {
            '@nf-internal/chunk-4A5BQSGU': { file: 'chunk-4A5BQSGU.js', initial: true },
          },
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

  // Layout 2 cached a bundle name on every record and a chunk list per bundle. Under the same minor
  // such an entry must be purged, never replayed onto the wire.
  it('publishes the same remoteEntry.json after a cache layout purge', async () => {
    const cold = await build(makeFedOptions(true));
    const cache = path.join(workspaceRoot, '.cache');
    for (const file of fs.readdirSync(cache).filter(f => f.endsWith('.meta.json'))) {
      const meta = JSON.parse(fs.readFileSync(path.join(cache, file), 'utf-8'));
      meta.externals = meta.externals.map((e: object) => ({ ...e, bundle: 'browser-shared' }));
      meta.chunks = { 'browser-shared': ['chunk-STALE.js'] };
      fs.writeFileSync(path.join(cache, file), JSON.stringify(meta));
    }
    const stampFile = path.join(cache, '.nf-cache.json');
    const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf-8'));
    fs.writeFileSync(stampFile, JSON.stringify({ ...stamp, layout: 2 }));
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

  // The output check must see the owner maps: chart-lazy is named by chart-lib's map alone, so a
  // check run on the info before the maps are added would only warn about it.
  it('fails the build when a chunk an owner map lists is gone from the output folder', async () => {
    const adapter = bundlerAdapter();
    const buildBundle = adapter.build.bind(adapter);
    let deleted: string | undefined;
    // Shared bundles are built first; a later bundle deletes chart-lazy after core renamed it.
    adapter.build = async (name, opts) => {
      const renamed = fs
        .readdirSync(dist)
        .find(
          file =>
            file !== 'chunk-LAZYAAAA.js' &&
            fs.readFileSync(path.join(dist, file), 'utf-8').includes('/* chart-lazy */')
        );
      if (renamed) {
        fs.rmSync(path.join(dist, renamed));
        deleted = renamed;
      }
      return buildBundle(name, opts);
    };
    setBuildAdapter(adapter);

    const error = await buildForFederation(makeConfig(), makeFedOptions(), EXTERNALS).catch(
      (e: Error) => e
    );

    expect(deleted).toMatch(/^chunk-\w+\.js$/);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`remoteEntry.json names '${deleted}'`);
  });

  it('returns what it publishes', async () => {
    const { returned, published } = await build();

    expect(JSON.parse(JSON.stringify({ $version: 'v5', ...returned }))).toEqual(published);
  });
});
