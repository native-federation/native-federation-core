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
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import { logger } from '../../utils/logger.js';
import { createFederationCache } from '../cache/federation-cache.js';
import { createFakeBuildAdapter } from './__test-helpers__/fake-build-adapter.js';
import { setBuildAdapter } from './build-adapter.js';
import { buildForFederation } from './build-for-federation.js';

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
const sourceOf = (file: string) => path.resolve(workspaceRoot, file);

// The bundler's output, per entry source file; chunk names carry an 8-character bundler hash.
const entryCode = (): Record<string, string> => ({
  [CHART]: `/* chart */ import './chunk-CHARTAAA.js'; export const lazy = () => import('./chunk-LAZYAAAA.js');`,
  [CHART_EXTRAS]: `/* extras */ import 'chart-lib'; import './chunk-EXTRASAA.js';`,
  [TSLIB]: `/* tslib */ import './chunk-TSLIBAAA.js';`,
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

function makeConfig(features: { denseChunking: boolean; denseExternals: boolean }) {
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
    sharedMappings: {},
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
      ...features,
    },
  };
  return config;
}

function makeFedOptions(): NormalizedFederationOptions {
  return {
    workspaceRoot,
    outputPath: 'dist',
    federationConfig: 'federation.config.js',
    projectName: 'mfe',
    entryPoints: [],
    cacheExternalArtifacts: false,
    watchLinkedDeps: false,
    federationCache: createFederationCache(path.join(workspaceRoot, '.cache')),
  };
}

async function build(features: { denseChunking: boolean; denseExternals: boolean }) {
  setBuildAdapter(bundlerAdapter());
  const returned = await buildForFederation(makeConfig(features), makeFedOptions(), [
    'chart-lib',
    'chart-lib/extras',
    'tslib',
  ]);
  const published = JSON.parse(
    fs.readFileSync(path.join(dist, 'remoteEntry.json'), 'utf-8')
  ) as FederationInfo;
  return { returned, published };
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

const flatRecord = (info: FederationInfo, packageName: string) =>
  info.shared.find(s => s.packageName === packageName) as SharedInfo;

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

  // Without denseChunking an exposed module keeps the bundler's relative imports and names.
  it('lists the relative chunk closure of each exposed module', async () => {
    const { published } = await build({ denseChunking: false, denseExternals: false });

    expect(exposedChunks(published)).toEqual({
      './Home': ['chunk-HOMEAAAA.js', 'chunk-SHAREDAA.js'],
      './Cart': ['chunk-SHAREDAA.js'],
    });
  });

  // With denseChunking the entries import `@nf-internal/*`, while chunk-to-chunk imports stay
  // relative; both resolve, and chunks are renamed by content.
  it('lists the dense chunk closure of each exposed module', async () => {
    const { published } = await build({ denseChunking: true, denseExternals: false });

    expect(fs.readFileSync(path.join(dist, 'Home.js'), 'utf-8')).toContain('@nf-internal/chunk-');
    expect(exposedChunks(published)).toEqual({
      './Home': [fileWith('home-core'), fileWith('exposed-shared')].sort(),
      './Cart': [fileWith('exposed-shared')],
    });
    expect(fileWith('home-core')).not.toBe('chunk-HOMEAAAA.js');
  });

  // A preload package's chunks are those of its bundle, listed once in top-level `chunks`.
  it.each([
    ['off', false],
    ['on', true],
  ])(
    'publishes no chunk list on shared records with denseChunking %s',
    async (_, denseChunking) => {
      const { published } = await build({ denseChunking, denseExternals: false });

      for (const record of published.shared) expect(record).not.toHaveProperty('chunks');
    }
  );

  it("lists a preload package's chunks under its bundle", async () => {
    const { published } = await build({ denseChunking: true, denseExternals: false });

    const bundle = flatRecord(published, 'chart-lib').bundle!;
    expect(published.chunks?.[bundle]).toEqual(
      expect.arrayContaining([
        fileWith('chart-core'),
        fileWith('chart-deep'),
        fileWith('extras-core'),
      ])
    );
  });

  it('publishes preload only on the packages configured with it', async () => {
    const { published } = await build({ denseChunking: false, denseExternals: false });

    expect(flatRecord(published, 'chart-lib').preload).toBe(true);
    expect(flatRecord(published, 'chart-lib/extras').preload).toBe(true);
    expect(flatRecord(published, 'tslib')).not.toHaveProperty('preload');
  });

  it('keeps a dense preload record one record, without a list of its own', async () => {
    const { published } = await build({ denseChunking: true, denseExternals: true });

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

  // The shape a runtime reads; names are content hashes, so they only move when the bytes do.
  it('assembles remoteEntry.json', async () => {
    const { published } = await build({ denseChunking: true, denseExternals: true });

    expect(published).toMatchInlineSnapshot(`
      {
        "$version": "v4",
        "chunks": {
          "browser-shared": [
            "chunk-QTDORPIU.js",
            "chunk-3CNQCWNB.js",
            "chunk-SDY535X5.js",
            "chunk-OCDHTTJP.js",
            "chunk-3JS3MFFU.js",
          ],
          "mapping-or-exposed": [
            "chunk-E4LY4AS4.js",
            "chunk-O4YEPRQO.js",
            "chunk-MV6JVKWS.js",
          ],
        },
        "exposes": [
          {
            "chunks": [
              "chunk-E4LY4AS4.js",
              "chunk-O4YEPRQO.js",
            ],
            "key": "./Home",
            "outFileName": "Home.js",
          },
          {
            "chunks": [
              "chunk-O4YEPRQO.js",
            ],
            "key": "./Cart",
            "outFileName": "Cart.js",
          },
        ],
        "name": "mfe",
        "shared": [
          {
            "bundle": "browser-shared",
            "entries": {
              "chart-lib": "chart_lib.D2XIoLh0XZ.js",
              "chart-lib/extras": "chart_lib_extras.GeNvxeJbTq.js",
            },
            "packageName": "chart-lib",
            "preload": true,
            "requiredVersion": "^1.0.0",
            "singleton": true,
            "strictVersion": true,
            "version": "1.0.0",
          },
          {
            "bundle": "browser-shared",
            "entries": {
              "tslib": "tslib.iAWSpLA311.js",
            },
            "packageName": "tslib",
            "requiredVersion": "^1.0.0",
            "singleton": true,
            "strictVersion": true,
            "version": "1.0.0",
          },
        ],
      }
    `);
  });

  it('returns what it publishes', async () => {
    const { returned, published } = await build({ denseChunking: true, denseExternals: true });

    expect(JSON.parse(JSON.stringify({ $version: 'v4', ...returned }))).toEqual(published);
  });
});
