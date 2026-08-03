import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  bundleSharedCore,
  calcHashCore,
  parseBuilderVersion,
  readBuilderPackageJson,
} from './bundle-shared.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import {
  createFakeBuildAdapter,
  type FakeBuildAdapter,
} from './__test-helpers__/fake-build-adapter.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import type { IoPort } from '../../domain/utils/io-port.contract.js';
import type { NFBuildAdapter } from '../../domain/core/build-adapter.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';

const io = createMemoryIo();

const expectedHash = (base: string) =>
  crypto
    .createHash('sha256')
    .update(base)
    .digest('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substring(0, 10);

describe('calcHashCore', () => {
  it('produces a 10-char base64url-safe hash', () => {
    const hash = calcHashCore(io, 'react_18.0.0_state');
    expect(hash).toHaveLength(10);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('matches a hand-computed sha256 base64url hash', () => {
    expect(calcHashCore(io, 'react_18.0.0_state')).toBe(expectedHash('react_18.0.0_state'));
  });

  it('is deterministic for the same input', () => {
    expect(calcHashCore(io, 'a')).toBe(calcHashCore(io, 'a'));
  });

  it('differs for different inputs', () => {
    expect(calcHashCore(io, 'a')).not.toBe(calcHashCore(io, 'b'));
  });
});

describe('readBuilderPackageJson', () => {
  it('walks up to the nearest package.json regardless of file depth', () => {
    const mem = createMemoryIo().setFile('/pkg/package.json', '{"version":"9.9.9"}');
    expect(readBuilderPackageJson(mem, '/pkg/dist/lib/core/build/bundle-shared.js')).toBe(
      '{"version":"9.9.9"}'
    );
  });

  it('returns the closest package.json when several exist on the path', () => {
    const mem = createMemoryIo()
      .setFile('/pkg/package.json', '{"version":"1.0.0"}')
      .setFile('/pkg/dist/package.json', '{"version":"2.0.0"}');
    expect(readBuilderPackageJson(mem, '/pkg/dist/lib/x.js')).toBe('{"version":"2.0.0"}');
  });

  it('falls back to "{}" when no package.json is found', () => {
    const mem = createMemoryIo();
    expect(readBuilderPackageJson(mem, '/nowhere/lib/x.js')).toBe('{}');
  });

  it('finds the builder package.json when installed under node_modules', () => {
    const mem = createMemoryIo().setFile(
      '/app/node_modules/@softarc/native-federation/package.json',
      '{"version":"4.1.3"}'
    );
    expect(
      readBuilderPackageJson(
        mem,
        '/app/node_modules/@softarc/native-federation/dist/lib/core/build/bundle-shared.js'
      )
    ).toBe('{"version":"4.1.3"}');
  });

  it('does not ascend past node_modules into an unrelated package.json', () => {
    const mem = createMemoryIo().setFile('/app/package.json', '{"version":"7.7.7"}');
    expect(
      readBuilderPackageJson(mem, '/app/node_modules/@softarc/native-federation/dist/lib/x.js')
    ).toBe('{}');
  });
});

describe('parseBuilderVersion', () => {
  it('extracts the version field', () => {
    expect(parseBuilderVersion('{"version":"4.1.3"}')).toBe('4.1.3');
  });

  it('returns "" when version is absent', () => {
    expect(parseBuilderVersion('{}')).toBe('');
  });

  it('returns "" on invalid JSON instead of throwing', () => {
    expect(parseBuilderVersion('')).toBe('');
    expect(parseBuilderVersion('not json')).toBe('');
  });
});

// bundleSharedCore walks up to the nearest package.json; this spec shares its folder, so the
// walk-up resolves the ROOT_PKG seeded below.
const ROOT_PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json');

const BUILD_OPTIONS = { platform: 'browser' as const, bundleName: 'shared', chunks: false };

const emptyRepo: PackageJsonRepository = {
  getPackageJsonFiles: () => [],
  findDepPackageJson: () => null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readJson: () => ({}) as any,
  exists: () => false,
};

function makeConfig(): NormalizedFederationConfig {
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
      denseExternals: false,
      integrityHashes: false,
      synthesizeCjsExports: true,
    },
  };
}

function makeFedOptions(
  overrides: Partial<NormalizedFederationOptions> = {}
): NormalizedFederationOptions {
  return {
    workspaceRoot: '/ws',
    outputPath: 'dist',
    federationConfig: 'federation.config.js',
    tsConfig: 'tsconfig.json',
    dev: false,
    federationCache: { externals: [], bundlerCache: undefined, cachePath: '/cache' },
    entryPoints: [],
    projectName: 'app',
    cacheExternalArtifacts: false,
    ...overrides,
  };
}

describe('bundleSharedCore (via injected io, repo and build adapter)', () => {
  it('bundles a package whose packageInfo is already configured', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const adapter = createFakeBuildAdapter({ io: mem });
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: 'foo/index.js', version: '1.0.0', esm: true },
      },
    };

    const result = await bundleSharedCore(
      { io: mem, repo: emptyRepo, adapter },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      ['rxjs'],
      BUILD_OPTIONS
    );

    expect(result.externals).toHaveLength(1);
    expect(result.externals[0]).toMatchObject({
      packageName: 'foo',
      version: '1.0.0',
      singleton: true,
      requiredVersion: '^1.0.0',
    });
    expect(result.externals[0]!.outFileName).toMatch(/^foo\..{10}\.js$/);
    expect(adapter.calls.setup).toHaveLength(1);
    expect(adapter.calls.dispose).toHaveLength(1);
    // metadata persisted through the injected io
    expect(mem.exists(path.join('/cache', 'shared.meta.json'))).toBe(true);
  });

  it('carries a configured pool through to the shared external', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const adapter = createFakeBuildAdapter({ io: mem });
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        pool: 'critical',
        packageInfo: { entryPoint: 'foo/index.js', version: '1.0.0', esm: true },
      },
    };

    const result = await bundleSharedCore(
      { io: mem, repo: emptyRepo, adapter },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    expect(result.externals[0]).toMatchObject({
      packageName: 'foo',
      pool: 'critical',
    });
  });

  it('omits pool from the shared external when it is not configured', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const adapter = createFakeBuildAdapter({ io: mem });
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: 'foo/index.js', version: '1.0.0', esm: true },
      },
    };

    const result = await bundleSharedCore(
      { io: mem, repo: emptyRepo, adapter },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    expect(result.externals[0]).not.toHaveProperty('pool');
  });

  it('resolves an inferred package through the injected repository', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const adapter = createFakeBuildAdapter({ io: mem });
    const repo: PackageJsonRepository = {
      getPackageJsonFiles: () => [{ content: {}, directory: '/ws' }],
      findDepPackageJson: () => '/ws/node_modules/foo/package.json',
      readJson: () => ({ version: '2.0.0', type: 'module', module: './index.mjs' }),
      exists: () => false,
    };
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^2.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
      },
    };

    const result = await bundleSharedCore(
      { io: mem, repo, adapter },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    expect(result.externals).toHaveLength(1);
    expect(result.externals[0]).toMatchObject({ packageName: 'foo', version: '2.0.0' });
  });

  it('names a shared entry by its content, so the name changes when the bundle changes', async () => {
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: 'foo/index.js', version: '1.0.0', esm: true },
      },
    };

    // Adapter that writes a given body as the entry's bundled content.
    const writingAdapter = (io: IoPort, body: string): NFBuildAdapter => {
      let outdir = '';
      let outName = '';
      return {
        async setup(_name, opts) {
          outdir = opts.outdir;
          outName = opts.entryPoints[0]!.outName;
        },
        async build() {
          io.writeText(path.join(outdir, outName), body);
          return [{ fileName: path.join(outdir, outName) }];
        },
        async dispose() {},
      };
    };

    const build = async (body: string) => {
      const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
      const result = await bundleSharedCore(
        { io: mem, repo: emptyRepo, adapter: writingAdapter(mem, body) },
        sharedBundles,
        makeConfig(),
        makeFedOptions(),
        [],
        BUILD_OPTIONS
      );
      return result.externals[0]!.outFileName;
    };

    const a = await build('export const x = 1;\n');
    const b = await build('export const x = 2;\n');

    expect(a).toMatch(/^foo\..{10}\.js$/);
    expect(a).toBe(await build('export const x = 1;\n')); // stable for identical content
    expect(a).not.toBe(b); // changes when content changes
  });

  it('routes a CommonJS external through a synthetic named-exports entry', async () => {
    const mem = createMemoryIo()
      .setFile(ROOT_PKG, '{}')
      .setFile('/n/dayjs/dayjs.min.js', '!function(t,e){module.exports=e()}(this,function(){})');
    const adapter = createFakeBuildAdapter({ io: mem });
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      dayjs: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.11.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: '/n/dayjs/dayjs.min.js', version: '1.11.0', esm: false },
      },
    };

    await bundleSharedCore(
      {
        io: mem,
        repo: emptyRepo,
        adapter,
        evaluateModule: () => ({ isDayjs: () => {}, extend: () => {} }),
      },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    const entryPoint = adapter.calls.setup[0]!.options.entryPoints[0]!;
    // Named after the hashed outName (dayjs.<hash>.js), so packages that normalize to the
    // same identifier can't clobber each other's synthetic entry.
    expect(path.dirname(entryPoint.fileName)).toBe(path.join('/cache', '.nf-cjs-entries'));
    expect(path.basename(entryPoint.fileName)).toMatch(/^dayjs\..+\.js$/);
    const synthetic = mem.readText(entryPoint.fileName);
    expect(synthetic).toContain('import _nfDefault from "/n/dayjs/dayjs.min.js";');
    expect(synthetic).toContain('as isDayjs');
  });

  it('leaves a CommonJS external untouched when synthesizeCjsExports is disabled', async () => {
    const mem = createMemoryIo()
      .setFile(ROOT_PKG, '{}')
      .setFile('/n/dayjs/dayjs.min.js', '!function(t,e){module.exports=e()}(this,function(){})');
    const adapter = createFakeBuildAdapter({ io: mem });
    const evaluate = vi.fn(() => ({ isDayjs: () => {} }));
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      dayjs: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.11.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: '/n/dayjs/dayjs.min.js', version: '1.11.0', esm: false },
      },
    };
    const config = makeConfig();
    config.features.synthesizeCjsExports = false;

    await bundleSharedCore(
      { io: mem, repo: emptyRepo, adapter, evaluateModule: evaluate },
      sharedBundles,
      config,
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    expect(evaluate).not.toHaveBeenCalled();
    expect(adapter.calls.setup[0]!.options.entryPoints[0]!.fileName).toBe('/n/dayjs/dayjs.min.js');
  });

  it('leaves an ESM external on its original entry and never evaluates it', async () => {
    const mem = createMemoryIo()
      .setFile(ROOT_PKG, '{}')
      .setFile('/n/rxjs/dist/esm/index.js', `export { Observable } from './internal/Observable';`);
    const adapter = createFakeBuildAdapter({ io: mem });
    const evaluate = vi.fn(() => ({}));
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      rxjs: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^7.0.0',
        version: '7.8.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: '/n/rxjs/dist/esm/index.js', version: '7.8.0', esm: true },
      },
    };

    await bundleSharedCore(
      { io: mem, repo: emptyRepo, adapter, evaluateModule: evaluate },
      sharedBundles,
      makeConfig(),
      makeFedOptions(),
      [],
      BUILD_OPTIONS
    );

    expect(adapter.calls.setup[0]!.options.entryPoints[0]!.fileName).toBe(
      '/n/rxjs/dist/esm/index.js'
    );
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('reuses the bundle cache when denseExternals is toggled (same output name)', async () => {
    const sharedBundles: Record<string, NormalizedExternalConfig> = {
      foo: {
        singleton: true,
        strictVersion: false,
        requiredVersion: '^1.0.0',
        version: '1.0.0',
        chunks: false,
        platform: 'browser',
        build: 'default',
        packageInfo: { entryPoint: 'foo/index.js', version: '1.0.0', esm: true },
      },
    };

    const buildWith = async (denseExternals: boolean) => {
      const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
      const config = makeConfig();
      config.features.denseExternals = denseExternals;
      const result = await bundleSharedCore(
        { io: mem, repo: emptyRepo, adapter: createFakeBuildAdapter({ io: mem }) },
        sharedBundles,
        config,
        makeFedOptions(),
        [],
        BUILD_OPTIONS
      );
      return result.externals[0]!.outFileName;
    };

    // denseExternals must not participate in the bundler cache key: identical output name.
    expect(await buildWith(false)).toBe(await buildWith(true));
  });

  const fooWith = (
    extra: Partial<NormalizedExternalConfig> = {}
  ): Record<string, NormalizedExternalConfig> => ({
    foo: {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^2.0.0',
      chunks: false,
      platform: 'browser',
      build: 'default',
      ...extra,
    },
  });

  const repoAtVersion = (version: string): PackageJsonRepository => ({
    getPackageJsonFiles: () => [{ content: {}, directory: '/ws' }],
    findDepPackageJson: () => '/ws/node_modules/foo/package.json',
    readJson: () => ({ version, type: 'module', module: './index.mjs' }),
    exists: () => false,
  });

  const cachedBuild = async (
    mem: ReturnType<typeof createMemoryIo>,
    version: string,
    sharedBundles: Record<string, NormalizedExternalConfig> = fooWith()
  ) => {
    const adapter = createFakeBuildAdapter({ io: mem });
    const result = await bundleSharedCore(
      { io: mem, repo: repoAtVersion(version), adapter },
      sharedBundles,
      makeConfig(),
      makeFedOptions({ cacheExternalArtifacts: true }),
      [],
      BUILD_OPTIONS
    );
    return { adapter, result };
  };

  // All three config styles must invalidate on an installed-version bump. `shareAll` and
  // `requiredVersion: 'auto'` leave `version` unset; an explicit range pins it to something that
  // stays constant across the bump — which is exactly how the stale bundle used to survive.
  const CONFIG_STYLES: Array<[string, Record<string, NormalizedExternalConfig>]> = [
    ['shareAll (no declared version)', fooWith()],
    ["share + requiredVersion 'auto'", fooWith({ requiredVersion: 'auto' })],
    ['share + explicit declared range', fooWith({ version: '^2.0.0' })],
  ];

  describe.each(CONFIG_STYLES)('installed-version invalidation — %s', (_label, sharedBundles) => {
    it('re-uses the cached externals when the installed version is unchanged', async () => {
      const mem = createMemoryIo().setFile(ROOT_PKG, '{}');

      await cachedBuild(mem, '2.0.0', sharedBundles);
      const { adapter, result } = await cachedBuild(mem, '2.0.0', sharedBundles);

      expect(adapter.calls.setup).toHaveLength(0);
      expect(result.externals[0]).toMatchObject({ packageName: 'foo', version: '2.0.0' });
    });

    it('rebuilds when the installed version changed under an unchanged config', async () => {
      const mem = createMemoryIo().setFile(ROOT_PKG, '{}');

      await cachedBuild(mem, '2.0.0', sharedBundles);
      const { adapter, result } = await cachedBuild(mem, '2.0.1', sharedBundles);

      expect(adapter.calls.setup).toHaveLength(1);
      expect(result.externals[0]).toMatchObject({ packageName: 'foo', version: '2.0.1' });
    });
  });

  // A configured packageInfo makes the build skip node_modules entirely, so the key must not
  // track it either — even when that packageInfo carries no version of its own. The missing
  // `version` is reachable in practice: ExternalConfig declares it optional and
  // with-native-federation.ts:99 casts rather than defaulting it.
  it('ignores the installed version when packageInfo is configured without a version', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const configured = fooWith({
      packageInfo: { entryPoint: 'foo/vendored.js', esm: true } as NonNullable<
        NormalizedExternalConfig['packageInfo']
      >,
    });

    await cachedBuild(mem, '2.0.0', configured);
    const { adapter } = await cachedBuild(mem, '2.0.1', configured);

    expect(adapter.calls.setup).toHaveLength(0);
  });

  // copyFiles runs on the fresh-build path too, so every name in the persisted metadata must
  // exist in the cache dir. Sourcemaps are the risky case: rewriteImports renames the entry to a
  // content hash and deletes the original, while the .map keeps its version-based name.
  it('copies sourcemaps alongside content-hashed entries without tripping the missing-file guard', async () => {
    const mem = createMemoryIo().setFile(ROOT_PKG, '{}');
    const adapter: FakeBuildAdapter = createFakeBuildAdapter({
      io: mem,
      results: name => {
        const setup = [...adapter.calls.setup].reverse().find(s => s.name === name)!;
        return setup.options.entryPoints.flatMap(ep => [
          { fileName: path.join(setup.options.outdir, ep.outName) },
          { fileName: path.join(setup.options.outdir, `${ep.outName}.map`) },
        ]);
      },
    });

    const result = await bundleSharedCore(
      { io: mem, repo: repoAtVersion('2.0.0'), adapter },
      fooWith(),
      makeConfig(),
      makeFedOptions({ cacheExternalArtifacts: true }),
      [],
      BUILD_OPTIONS
    );

    const outFileName = result.externals[0]!.outFileName;
    expect(mem.isFile(path.join('/ws/dist', outFileName))).toBe(true);

    const persisted: { files: string[] } = JSON.parse(
      mem.readText(path.join('/cache', 'shared.meta.json'))
    );
    expect(persisted.files).toContain(outFileName);
    expect(persisted.files.filter(f => f.endsWith('.map'))).toHaveLength(1);
    for (const file of persisted.files) {
      expect(mem.isFile(path.join('/ws/dist', file))).toBe(true);
    }
  });
});
