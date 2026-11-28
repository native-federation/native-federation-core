import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';

import { bundleExposedAndMappingsCore } from './bundle-exposed-and-mappings.js';
import { getMappingVersionCore } from './mapping-record.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { createFakeBuildAdapter } from './__test-helpers__/fake-build-adapter.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { logger } from '../../utils/logger.js';
import { assembleFederationInfo } from './assemble-federation-info.js';
import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { ArtifactInfo } from '../../domain/core/federation-info.contract.js';

// The chunk files a build wrote: every script that is not an entry.
const chunkFiles = ({ outputFiles = [], exposes, mappings }: ArtifactInfo) => {
  const entries = new Set([...exposes, ...mappings].map(e => e.outFileName));
  return outputFiles
    .map(f => f.fileName)
    .filter(f => f.endsWith('.js') && !entries.has(f))
    .sort();
};

// The chunk an entry imports, by the file name its `@nf-internal` import stands for.
const importedChunk = (io: ReturnType<typeof createMemoryIo>, entryFile: string) =>
  /@nf-internal\/(chunk-[A-Z2-7]{8})/.exec(io.readText(entryFile))![1] + '.js';

describe('getMappingVersionCore', () => {
  it('returns the version from the nearest package.json walking up', () => {
    const io = createMemoryIo()
      .setFile('/ws/libs/shared/package.json', JSON.stringify({ version: '1.2.3' }))
      .setFile('/ws/libs/shared/src/lib/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/lib/index.ts', '/ws')).toBe('1.2.3');
  });

  it('returns the version when package.json sits next to the entry file', () => {
    const io = createMemoryIo()
      .setFile('/ws/libs/shared/package.json', JSON.stringify({ version: '4.5.6' }))
      .setFile('/ws/libs/shared/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/index.ts', '/ws')).toBe('4.5.6');
  });

  it('falls back to the workspace package.json when no closer one is found', () => {
    const io = createMemoryIo()
      .setFile('/ws/package.json', JSON.stringify({ version: '9.9.9' }))
      .setFile('/ws/libs/shared/src/lib/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/lib/index.ts', '/ws')).toBe('9.9.9');
  });

  it('skips a package.json without a version and keeps walking up', () => {
    const io = createMemoryIo()
      .setFile('/ws/libs/shared/package.json', JSON.stringify({ name: 'shared' }))
      .setFile('/ws/package.json', JSON.stringify({ version: '7.0.0' }))
      .setFile('/ws/libs/shared/src/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/index.ts', '/ws')).toBe('7.0.0');
  });

  it('returns "" when no package.json exists at or above the entry', () => {
    const io = createMemoryIo().setFile('/ws/libs/shared/src/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/index.ts', '/ws')).toBe('');
  });

  it('does not walk above workspaceRoot', () => {
    const io = createMemoryIo()
      .setFile('/outer/package.json', JSON.stringify({ version: 'should-not-be-used' }))
      .setFile('/outer/ws/libs/shared/src/index.ts', '');
    expect(getMappingVersionCore(io, '/outer/ws/libs/shared/src/index.ts', '/outer/ws')).toBe('');
  });

  it('warns and returns "" when a present package.json is malformed', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile('/ws/libs/shared/package.json', '{ not json')
      .setFile('/ws/libs/shared/src/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/index.ts', '/ws')).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
  });
});

function makeConfig(
  overrides: Partial<NormalizedFederationConfig> = {}
): NormalizedFederationConfig {
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
      denseChunking: true,
      denseExternals: true,
      integrityHashes: false,
      synthesizeCjsExports: true,
      strictImports: false,
    },
    ...overrides,
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
    dev: true,
    federationCache: { externals: [], bundlerCache: undefined, cachePath: '/cache' },
    entryPoints: [],
    projectName: 'app',
    cacheExternalArtifacts: false,
    watchLinkedDeps: false,
    ...overrides,
  };
}

describe('bundleExposedAndMappingsCore (via injected build adapter)', () => {
  it('maps exposes and shared mappings from the adapter results', async () => {
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/foo': 'foo' },
    });
    const adapter = createFakeBuildAdapter();

    const result = await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), [
      'rxjs',
    ]);

    expect(result.exposes).toEqual([
      expect.objectContaining({ key: './Comp', outFileName: 'Comp.js' }),
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({ packageName: 'foo', outFileName: 'foo.js' }),
    ]);
    expect(adapter.calls.setup.map(c => [c.name, c.options.kind])).toEqual([
      ['mapping-bundle', 'mapping'],
      ['mapping-or-exposed', 'exposed'],
    ]);
    expect(adapter.calls.build.map(c => c.name)).toEqual(['mapping-bundle', 'mapping-or-exposed']);
  });

  // Pins what each bundle's setup receives when no mapping sets chunks: the global value, for
  // every bundle.
  it.each([true, false])(
    'sets up every bundle with the global chunks setting (%s)',
    async chunks => {
      const config = makeConfig({
        chunks,
        exposes: { './Comp': { file: './src/comp.ts' } },
        sharedMappings: {
          './libs/a': '@org/a',
          './libs/b': '@org/b',
          './libs/c/x': '@org/c/x',
          './libs/c/y': '@org/c/y',
        },
        sharedMappingsConfig: {
          '@org/b': { singleton: true, strictVersion: false, build: 'separate' },
          '@org/c/*': { singleton: true, strictVersion: false, build: 'package' },
        },
      });
      const io = createMemoryIo();
      const adapter = createFakeBuildAdapter({ io });

      await bundleExposedAndMappingsCore({ adapter, io }, config, makeFedOptions(), []);

      expect(
        adapter.calls.setup.map(c => ({
          name: c.name,
          chunks: c.options.chunks,
          entryPoints: c.options.entryPoints.map(ep => ep.outName),
        }))
      ).toEqual([
        { name: 'mapping-bundle', chunks, entryPoints: ['_org_a.js'] },
        { name: 'mapping-org_b', chunks, entryPoints: ['_org_b.js'] },
        { name: 'mapping-org_c', chunks, entryPoints: ['_org_c_x.js', '_org_c_y.js'] },
        { name: 'mapping-or-exposed', chunks, entryPoints: ['Comp.js'] },
      ]);
    }
  );

  // core#196: output names keep only [A-Za-z0-9_], and file systems may ignore case; without a
  // hash a dev build writes one file over the other, so the config is warned about up front.
  describe('output files shared by two entries', () => {
    afterEach(() => vi.restoreAllMocks());
    const pkg = { singleton: true, strictVersion: false, build: 'package' as const };

    it.each([
      [
        'two mappings in different bundles',
        {
          sharedMappings: { './libs/a': '@org/a-b/x', './libs/b': '@org/a/b-x' },
          sharedMappingsConfig: { '@org/a-b/x': pkg, '@org/a/b-x': pkg },
        },
        "shared mapping '@org/a-b/x' and shared mapping '@org/a/b-x' are written as '_org_a_b_x.js'",
      ],
      [
        'a mapping and an exposed module',
        { sharedMappings: { './libs/utils': 'utils' }, exposes: { './utils': { file: './u.ts' } } },
        "shared mapping 'utils' and exposed module './utils' are written as 'utils.js'",
      ],
      [
        'names that differ only in case',
        { sharedMappings: { './libs/b': 'button' }, exposes: { './Button': { file: './b.ts' } } },
        "shared mapping 'button' and exposed module './Button' are written as 'button.js'",
      ],
    ])('warns about %s', async (_label, overrides, expected) => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const adapter = createFakeBuildAdapter();

      await bundleExposedAndMappingsCore({ adapter }, makeConfig(overrides), makeFedOptions(), []);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(expected));
    });

    it('stays quiet without a shared file', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const config = makeConfig({
        sharedMappings: { './libs/a': '@org/a' },
        exposes: { './a': { file: './a.ts' } },
      });

      await bundleExposedAndMappingsCore(
        { adapter: createFakeBuildAdapter() },
        config,
        makeFedOptions(),
        []
      );

      expect(warn).not.toHaveBeenCalled();
    });

    // The names come from the config, which a rebuild reuses: once per full build is enough.
    it('stays quiet on a rebuild', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const adapter = createFakeBuildAdapter();
      const config = makeConfig({
        sharedMappings: { './libs/utils': 'utils' },
        exposes: { './utils': { file: './u.ts' } },
      });

      await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);
      warn.mockClear();
      await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), [], ['/ws/x.ts']);

      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('leaves the adapter alone for a side that has no entry points', async () => {
    const config = makeConfig({ exposes: { './Comp': { file: './src/comp.ts' } } });
    const adapter = createFakeBuildAdapter();

    await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);

    expect(adapter.calls.setup.map(c => c.name)).toEqual(['mapping-or-exposed']);
  });

  // core#156: a bare outputPath reached the adapter as-is and was resolved against cwd, so
  // exposed modules and mappings landed apart from remoteEntry.json.
  it('hands the adapter an outdir resolved against workspaceRoot', async () => {
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/foo': 'foo' },
    });
    const adapter = createFakeBuildAdapter();

    await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);

    expect(adapter.calls.setup.map(c => c.options.outdir)).toEqual(['/ws/dist', '/ws/dist']);
  });

  it('keeps an absolute outputPath as the outdir', async () => {
    const config = makeConfig({ exposes: { './Comp': { file: './src/comp.ts' } } });
    const adapter = createFakeBuildAdapter();

    await bundleExposedAndMappingsCore(
      { adapter },
      config,
      makeFedOptions({ outputPath: '/out/dist' }),
      []
    );

    expect(adapter.calls.setup[0]!.options.outdir).toBe('/out/dist');
  });

  // A relative expose was handed over as-is, and the esbuild adapter resolved it against cwd,
  // so a build run from outside the workspace could not find its exposed modules.
  it('hands the adapter exposed entry points resolved against workspaceRoot', async () => {
    const config = makeConfig({ exposes: { './Comp': { file: './src/comp.ts' } } });
    const adapter = createFakeBuildAdapter();

    const result = await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);

    const resolved = path.resolve('/ws', 'src/comp.ts');
    expect(adapter.calls.setup[0]!.options.entryPoints[0]!.fileName).toBe(resolved);
    expect(result.exposes[0]!.dev).toEqual({ entryPoint: resolved.replace(/\\/g, '/') });
  });

  // path.join would have nested it: /ws/abs/src/comp.ts.
  it('passes an absolute expose through unchanged', async () => {
    const file = path.resolve('/abs/src/comp.ts');
    const config = makeConfig({ exposes: { './Comp': { file } } });
    const adapter = createFakeBuildAdapter();

    const result = await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);

    expect(adapter.calls.setup[0]!.options.entryPoints[0]!.fileName).toBe(file);
    expect(result.exposes[0]!.dev).toEqual({ entryPoint: file.replace(/\\/g, '/') });
  });

  describe('exposed outNames', () => {
    const outNames = (adapter: ReturnType<typeof createFakeBuildAdapter>) =>
      adapter.calls.setup.at(-1)!.options.entryPoints.map(ep => ep.outName);

    it('keeps the last segment of the key as a flat file name', async () => {
      const config = makeConfig({
        exposes: { './Comp': { file: './src/comp.ts' }, './nested/Other': { file: './src/o.ts' } },
      });
      const adapter = createFakeBuildAdapter();

      await bundleExposedAndMappingsCore({ adapter }, config, makeFedOptions(), []);

      expect(outNames(adapter)).toEqual(['Comp.js', 'Other.js']);
    });

    // Both published adapters emit `path.parse(outName).name`, so './a/Cmp' and './b/Cmp' wrote one
    // file: esbuild failed the dev build, and a hashed build found no result for the second.
    it('gives a second key with the same last segment its own name, in a hashed build', async () => {
      const config = makeConfig({
        exposes: {
          './a/Cmp': { file: './src/a.ts' },
          './b/Cmp': { file: './src/b.ts' },
          './Cmp_2': { file: './src/c.ts' },
          './c/Cmp': { file: './src/d.ts' },
        },
      });
      const adapter = createFakeBuildAdapter({
        results: () =>
          outNames(adapter).map((outName, i) => ({
            fileName: `/ws/dist/${path.parse(outName).name}-HASH000${i}.js`,
          })),
      });

      const result = await bundleExposedAndMappingsCore(
        { adapter },
        config,
        makeFedOptions({ dev: false }),
        []
      );

      // './Cmp_2' does not collide, so it keeps its name and the duplicate skips past it.
      expect(outNames(adapter)).toEqual(['Cmp.js', 'Cmp_3.js', 'Cmp_2.js', 'Cmp_4.js']);
      expect(result.exposes.map(e => [e.key, e.outFileName])).toEqual([
        ['./a/Cmp', 'Cmp-HASH0000.js'],
        ['./b/Cmp', 'Cmp_3-HASH0001.js'],
        ['./Cmp_2', 'Cmp_2-HASH0002.js'],
        ['./c/Cmp', 'Cmp_4-HASH0003.js'],
      ]);
    });
  });

  // mappingVersion is off in makeConfig, so this is the un-annotated baseline: no version
  // is detected and requiredVersion stays empty.
  it('emits the pre-existing defaults for an un-annotated mapping', async () => {
    const config = makeConfig({ sharedMappings: { './libs/foo': 'foo' } });

    const result = await bundleExposedAndMappingsCore(
      { adapter: createFakeBuildAdapter() },
      config,
      makeFedOptions({ dev: false }),
      []
    );

    expect(result.mappings[0]).toEqual({
      packageName: 'foo',
      outFileName: 'foo.js',
      requiredVersion: '',
      singleton: true,
      strictVersion: false,
      version: '',
      dev: undefined,
    });
  });

  it('applies a configured mapping override', async () => {
    const config = makeConfig({
      sharedMappings: { './libs/foo': 'foo' },
      sharedMappingsConfig: {
        foo: {
          singleton: false,
          strictVersion: true,
          version: '2.1.0',
          shareScope: 'custom',
          pool: 'p1',
        },
      },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter: createFakeBuildAdapter() },
      config,
      makeFedOptions({ dev: false }),
      []
    );

    expect(result.mappings[0]).toMatchObject({
      packageName: 'foo',
      singleton: false,
      strictVersion: true,
      version: '2.1.0',
      // derived from the explicit version, since requiredVersion was not set
      requiredVersion: '~2.1.0',
      shareScope: 'custom',
      pool: 'p1',
    });
  });

  it('lets an explicit requiredVersion win over the derived one', async () => {
    const config = makeConfig({
      sharedMappings: { './libs/foo': 'foo' },
      sharedMappingsConfig: {
        foo: { singleton: true, strictVersion: true, version: '2.1.0', requiredVersion: '^2.0.0' },
      },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter: createFakeBuildAdapter() },
      config,
      makeFedOptions({ dev: false }),
      []
    );

    expect(result.mappings[0]).toMatchObject({ requiredVersion: '^2.0.0', version: '2.1.0' });
  });

  describe('requiredVersion as a range format', () => {
    async function mappingFor(cfg: Partial<NormalizedMappingConfig>) {
      const config = makeConfig({
        sharedMappings: { './libs/foo': 'foo' },
        sharedMappingsConfig: { foo: { singleton: true, strictVersion: true, ...cfg } },
      });

      const result = await bundleExposedAndMappingsCore(
        { adapter: createFakeBuildAdapter() },
        config,
        makeFedOptions({ dev: false }),
        []
      );
      return result.mappings[0]!;
    }

    it('formats the version with the requested range', async () => {
      expect(await mappingFor({ version: '2.1.0', requiredVersion: { range: '^' } })).toMatchObject(
        {
          requiredVersion: '^2.1.0',
          version: '2.1.0',
        }
      );
    });

    it('drops the prefix for an exact range', async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: { range: 'exact' } })
      ).toMatchObject({ requiredVersion: '2.1.0' });
    });

    it("maps 'minor' to ^ and 'patch' to ~", async () => {
      const minor = await mappingFor({ version: '2.1.0', requiredVersion: { range: 'minor' } });
      const patch = await mappingFor({ version: '2.1.0', requiredVersion: { range: 'patch' } });

      expect(minor.requiredVersion).toBe('^2.1.0');
      expect(patch.requiredVersion).toBe('~2.1.0');
    });

    // The one place mappings differ from a shared package, whose baseline is the raw spec.
    it('keeps the ~ default when no range is named', async () => {
      expect(await mappingFor({ version: '2.1.0', requiredVersion: {} })).toMatchObject({
        requiredVersion: '~2.1.0',
      });
    });

    it('lets the version inside requiredVersion drive both fields', async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: { version: '3.0.0', range: '^' } })
      ).toMatchObject({ requiredVersion: '^3.0.0', version: '3.0.0' });
    });

    it("falls back to the configured version when the object asks for 'auto'", async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: { version: 'auto', range: '^' } })
      ).toMatchObject({ requiredVersion: '^2.1.0', version: '2.1.0' });
    });

    it('keeps a prerelease tag attached', async () => {
      expect(
        await mappingFor({ version: '2.1.0-next.1', requiredVersion: { range: '^' } })
      ).toMatchObject({ requiredVersion: '^2.1.0-next.1' });
    });

    // A prerelease with a dash inside the tag, or build metadata after it, must still reach
    // the formatter -- falling through would turn the ~ default into an exact pin.
    it('keeps the default ~ on an awkward prerelease tag', async () => {
      expect(await mappingFor({ version: '1.0.0-rc-1' })).toMatchObject({
        requiredVersion: '~1.0.0-rc-1',
      });
      expect(await mappingFor({ version: '1.0.0-beta.1+sha' })).toMatchObject({
        requiredVersion: '~1.0.0-beta.1+sha',
      });
    });

    // federation.config.js is plain JS, so null gets past the types.
    it('treats a null requiredVersion as absent', async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: null as unknown as undefined })
      ).toMatchObject({ requiredVersion: '~2.1.0', version: '2.1.0' });
    });

    it('ignores an empty version inside the object', async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: { version: '', range: '^' } })
      ).toMatchObject({ requiredVersion: '^2.1.0', version: '2.1.0' });
    });

    it('leaves a multi-comparator range alone', async () => {
      expect(
        await mappingFor({ version: '>=1.0.0 <2.0.0', requiredVersion: { range: '^' } })
      ).toMatchObject({ requiredVersion: '>=1.0.0 <2.0.0' });
    });

    // mappingVersion is off in makeConfig, so nothing is detected.
    it('stays empty when no version is known', async () => {
      expect(await mappingFor({ requiredVersion: { range: '^' } })).toMatchObject({
        requiredVersion: '',
        version: '',
      });
    });

    it('still takes a literal string verbatim', async () => {
      expect(
        await mappingFor({ version: '2.1.0', requiredVersion: '>=1.0.0 <3.0.0' })
      ).toMatchObject({ requiredVersion: '>=1.0.0 <3.0.0' });
    });
  });

  // The config table is keyed by the pattern the user wrote, not the resolved import.
  it('matches a resolved mapping import against its wildcard pattern', async () => {
    const config = makeConfig({
      sharedMappings: { './libs/ui/button': '@org/ui/button' },
      sharedMappingsConfig: { '@org/ui/*': { singleton: false, strictVersion: false } },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter: createFakeBuildAdapter() },
      config,
      makeFedOptions({ dev: false }),
      []
    );

    expect(result.mappings[0]).toMatchObject({
      packageName: '@org/ui/button',
      singleton: false,
    });
  });

  it.each([
    ["export * from './chunk-AAAAAAAA.js';\n"],
    ['export const l=()=>import(`./chunk-AAAAAAAA.js`);\n'],
  ])(
    'names chunks after their content and points the rewritten entries at them: %s',
    async entryText => {
      const io = createMemoryIo();
      const config = makeConfig({
        exposes: { './Comp': { file: './src/comp.ts' } },
        chunks: true,
      });
      const adapter = createFakeBuildAdapter({
        results: () => {
          io.setFile('/ws/dist/Comp.js', entryText);
          io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
          return [{ fileName: '/ws/dist/Comp.js' }, { fileName: '/ws/dist/chunk-AAAAAAAA.js' }];
        },
      });

      const result = await bundleExposedAndMappingsCore(
        { adapter, io },
        config,
        makeFedOptions(),
        []
      );

      const [chunk] = chunkFiles(result);
      expect(chunk).toMatch(/^chunk-[A-Z2-7]{8}\.js$/);
      expect(chunk).not.toBe('chunk-AAAAAAAA.js');
      expect(io.isFile(`/ws/dist/${chunk}`)).toBe(true);
      expect(io.isFile('/ws/dist/chunk-AAAAAAAA.js')).toBe(false);
      expect(io.readText('/ws/dist/Comp.js')).toContain(
        `@nf-internal/${chunk!.replace(/\.js$/, '')}`
      );
      expect(io.readText('/ws/dist/Comp.js')).not.toContain('AAAAAAAA');
    }
  );

  // A chunk is a non-entry script the adapter reported: an entry, or a file left in the folder by
  // an earlier build, is no chunk and keeps its relative import.
  it('rewrites only the reported chunks of a bundle', async () => {
    const io = createMemoryIo().setFile('/ws/dist/stale-AAAAAAAA.js', 'export const s = 1;\n');
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' }, './Other': { file: './src/other.ts' } },
      chunks: true,
    });
    const adapter = createFakeBuildAdapter({
      results: () => {
        io.setFile(
          '/ws/dist/Comp.js',
          "import './Other.js';\nimport './stale-AAAAAAAA.js';\nexport * from './chunk-AAAAAAAA.js';\n"
        );
        io.setFile('/ws/dist/Other.js', 'export const o = 1;\n');
        io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
        return ['Comp.js', 'Other.js', 'chunk-AAAAAAAA.js'].map(f => ({
          fileName: `/ws/dist/${f}`,
        }));
      },
    });

    await bundleExposedAndMappingsCore({ adapter, io }, config, makeFedOptions(), []);

    const comp = io.readText('/ws/dist/Comp.js');
    expect(comp).toContain("import './Other.js';");
    expect(comp).toContain("import './stale-AAAAAAAA.js';");
    expect(comp).toMatch(/from '@nf-internal\/chunk-[A-Z2-7]{8}'/);
  });

  it('builds a mapping that asked for its own bundle apart from the rest', async () => {
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/a': '@org/a', './libs/b': '@org/b' },
      sharedMappingsConfig: {
        '@org/a': { singleton: true, strictVersion: false, build: 'separate' },
      },
      chunks: true,
    });
    const io = createMemoryIo();
    const adapter = createFakeBuildAdapter({ io });

    const result = await bundleExposedAndMappingsCore(
      { adapter, io },
      config,
      makeFedOptions(),
      []
    );

    expect(adapter.calls.build.map(c => c.name)).toEqual([
      'mapping-org_a',
      'mapping-bundle',
      'mapping-or-exposed',
    ]);
    expect(result.mappings.map(m => m.packageName)).toEqual(['@org/a', '@org/b']);
    for (const mapping of result.mappings) expect(mapping).not.toHaveProperty('bundle');
  });

  it('sets up a mapping bundle with its own chunks and the exposed bundle with the global', async () => {
    const config = makeConfig({
      chunks: true,
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/a': '@org/a', './libs/b': '@org/b' },
      sharedMappingsConfig: {
        '@org/a': { singleton: true, strictVersion: false, build: 'separate', chunks: false },
      },
    });
    const io = createMemoryIo();
    const adapter = createFakeBuildAdapter({ io });

    await bundleExposedAndMappingsCore({ adapter, io }, config, makeFedOptions(), []);

    expect(adapter.calls.setup.map(c => [c.name, c.options.chunks])).toEqual([
      ['mapping-org_a', false],
      ['mapping-bundle', true],
      ['mapping-or-exposed', true],
    ]);
  });

  // Chunk naming follows each bundle's own chunks, so a mapping that splits while the global
  // setting does not still gets its chunks content-named and imported as `@nf-internal/*`.
  it('names the chunks of a mapping that splits when the global setting does not', async () => {
    const io = createMemoryIo();
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/foo': 'foo' },
      sharedMappingsConfig: { foo: { singleton: true, strictVersion: false, chunks: true } },
      chunks: false,
    });
    const adapter = createFakeBuildAdapter({
      results: name => {
        if (name !== 'mapping-bundle') {
          io.setFile('/ws/dist/Comp.js', 'export {};\n');
          return [{ fileName: '/ws/dist/Comp.js' }];
        }
        io.setFile('/ws/dist/foo.js', "export * from './chunk-AAAAAAAA.js';\n");
        io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const m = 1;\n');
        return [{ fileName: '/ws/dist/foo.js' }, { fileName: '/ws/dist/chunk-AAAAAAAA.js' }];
      },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter, io },
      config,
      makeFedOptions(),
      []
    );

    expect(chunkFiles(result)).toEqual([expect.stringMatching(/^chunk-[A-Z2-7]{8}\.js$/)]);
    expect(io.readText('/ws/dist/foo.js')).toMatch(/from '@nf-internal\/chunk-[A-Z2-7]{8}'/);
  });

  it('keeps a mapping chunk and an exposed chunk in separate bundles', async () => {
    const io = createMemoryIo();
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      sharedMappings: { './libs/foo': 'foo' },
      chunks: true,
    });
    // Adversarial fixture: a real bundler hashes a chunk's output bytes, so one name means one
    // set of bytes. Here both builds emit a differing chunk under one name, to pin that neither
    // build can reach into the other's output.
    const adapter = createFakeBuildAdapter({
      results: name => {
        const entry = name === 'mapping-bundle' ? '/ws/dist/foo.js' : '/ws/dist/Comp.js';
        const body = name === 'mapping-bundle' ? 'export const m = 1;\n' : 'export const e = 2;\n';
        io.setFile(entry, "export * from './chunk-AAAAAAAA.js';\n");
        io.setFile('/ws/dist/chunk-AAAAAAAA.js', body);
        return [{ fileName: entry }, { fileName: '/ws/dist/chunk-AAAAAAAA.js' }];
      },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter, io },
      config,
      makeFedOptions(),
      []
    );

    const mappingChunk = importedChunk(io, '/ws/dist/foo.js');
    const exposedChunk = importedChunk(io, '/ws/dist/Comp.js');
    expect(exposedChunk).not.toBe(mappingChunk);
    expect(io.readText(`/ws/dist/${mappingChunk}`)).toBe('export const m = 1;\n');
    expect(io.readText(`/ws/dist/${exposedChunk}`)).toBe('export const e = 2;\n');
    expect(chunkFiles(result)).toEqual([mappingChunk, exposedChunk].sort());
  });

  describe('output files (core#177)', () => {
    afterEach(() => vi.restoreAllMocks());

    // One mapping and one expose, each split into an entry and a chunk with source maps, as
    // esbuild emits them with `chunks` on.
    const chunkedFixture = (io: ReturnType<typeof createMemoryIo>) =>
      createFakeBuildAdapter({
        results: name => {
          const [entry, chunk] =
            name === 'mapping-bundle'
              ? ['foo.js', 'chunk-MAPPING1.js']
              : ['Comp.js', 'chunk-EXPOSED1.js'];
          io.setFile(`/ws/dist/${entry}`, `export * from './${chunk}';\n`);
          io.setFile(`/ws/dist/${entry}.map`, '{}');
          io.setFile(`/ws/dist/${chunk}`, `export const x = '${name}';\n`);
          io.setFile(`/ws/dist/${chunk}.map`, '{}');
          return [entry, `${entry}.map`, chunk, `${chunk}.map`].map(f => ({
            fileName: `/ws/dist/${f}`,
          }));
        },
      });

    const chunkedConfig = () =>
      makeConfig({
        exposes: { './Comp': { file: './src/comp.ts' } },
        sharedMappings: { './libs/foo': 'foo' },
        chunks: true,
        features: { ...makeConfig().features, integrityHashes: true },
      });

    const names = (files: { fileName: string }[] = []) => files.map(f => f.fileName).sort();
    const scripts = (files: { fileName: string }[] = []) =>
      names(files).filter(f => f.endsWith('.js'));

    it('reports mapping and exposed chunks among the written files', async () => {
      const io = createMemoryIo();

      const result = await bundleExposedAndMappingsCore(
        { adapter: chunkedFixture(io), io },
        chunkedConfig(),
        makeFedOptions(),
        []
      );

      const mappingChunk = importedChunk(io, '/ws/dist/foo.js');
      const exposedChunk = importedChunk(io, '/ws/dist/Comp.js');
      expect(names(result.outputFiles)).toEqual(
        [
          'Comp.js',
          'Comp.js.map',
          exposedChunk,
          `${exposedChunk}.map`,
          mappingChunk,
          `${mappingChunk}.map`,
          'foo.js',
          'foo.js.map',
        ].sort()
      );
      expect(result.outputFiles!.every(f => f.platform === 'browser')).toBe(true);
    });

    it('hashes chunks into the integrity map', async () => {
      const io = createMemoryIo();

      const result = await bundleExposedAndMappingsCore(
        { adapter: chunkedFixture(io), io },
        chunkedConfig(),
        makeFedOptions(),
        []
      );

      expect(Object.keys(result.integrity!)).toEqual(expect.arrayContaining(chunkFiles(result)));
    });

    it('keeps the integrity keys equal to the written scripts', async () => {
      const io = createMemoryIo();

      const result = await bundleExposedAndMappingsCore(
        { adapter: chunkedFixture(io), io },
        chunkedConfig(),
        makeFedOptions(),
        []
      );

      expect(Object.keys(result.integrity!).sort()).toEqual(scripts(result.outputFiles));
    });

    it('lists the content-renamed chunks, not the bundler names', async () => {
      const io = createMemoryIo();

      const result = await bundleExposedAndMappingsCore(
        { adapter: chunkedFixture(io), io },
        chunkedConfig(),
        makeFedOptions(),
        []
      );

      const published = [
        importedChunk(io, '/ws/dist/foo.js'),
        importedChunk(io, '/ws/dist/Comp.js'),
      ];
      expect(scripts(result.outputFiles)).toEqual(['Comp.js', 'foo.js', ...published].sort());
      expect(names(result.outputFiles)).not.toContain('chunk-MAPPING1.js');
      // The renamed chunk carries its source map along.
      for (const chunk of published) expect(names(result.outputFiles)).toContain(`${chunk}.map`);
      expect(names(result.outputFiles).every(f => io.isFile(`/ws/dist/${f}`))).toBe(true);
    });

    // A CSS import or a file-loader asset leaves a non-script output beside the chunks.
    it('lists an emitted asset but never publishes or hashes it', async () => {
      const io = createMemoryIo();
      const adapter = createFakeBuildAdapter({
        results: () => {
          io.setFile(
            '/ws/dist/Comp.js',
            "import './Comp.css';\nexport * from './chunk-AAAAAAAA.js';\n"
          );
          io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
          io.setFile('/ws/dist/Comp.css', '.a{}');
          return ['Comp.js', 'chunk-AAAAAAAA.js', 'Comp.css'].map(f => ({
            fileName: `/ws/dist/${f}`,
          }));
        },
      });

      const result = await bundleExposedAndMappingsCore(
        { adapter, io },
        makeConfig({
          exposes: { './Comp': { file: './src/comp.ts' } },
          chunks: true,
          features: { ...makeConfig().features, integrityHashes: true },
        }),
        makeFedOptions(),
        []
      );

      expect(names(result.outputFiles)).toContain('Comp.css');
      expect(Object.keys(result.integrity!)).not.toContain('Comp.css');
      expect(io.readText('/ws/dist/Comp.css')).toBe('.a{}');
      expect(io.readText('/ws/dist/Comp.js')).toContain("import './Comp.css';");
    });

    // Each owner lists its own chunks once remoteEntry.json is assembled; a bundle lists none.
    it('returns no chunk list per bundle', async () => {
      const io = createMemoryIo();

      const result = await bundleExposedAndMappingsCore(
        { adapter: createFakeBuildAdapter({ io }), io },
        makeConfig({
          exposes: { './Comp': { file: './src/comp.ts' } },
          chunks: true,
        }),
        makeFedOptions(),
        []
      );

      expect(result).not.toHaveProperty('chunks');
    });

    // An outdir that is not cleaned between builds can still hold a map from an earlier build.
    it('lists a renamed chunk map only when the bundler emitted one', async () => {
      const io = createMemoryIo();
      const adapter = createFakeBuildAdapter({
        results: () => {
          io.setFile('/ws/dist/Comp.js', "export * from './chunk-AAAAAAAA.js';\n");
          io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
          return [{ fileName: '/ws/dist/Comp.js' }, { fileName: '/ws/dist/chunk-AAAAAAAA.js' }];
        },
      });
      const config = makeConfig({
        exposes: { './Comp': { file: './src/comp.ts' } },
        chunks: true,
      });
      await bundleExposedAndMappingsCore({ adapter, io }, config, makeFedOptions(), []);
      const chunk = importedChunk(io, '/ws/dist/Comp.js');
      io.setFile(`/ws/dist/${chunk}.map`, '{}');

      const result = await bundleExposedAndMappingsCore(
        { adapter, io },
        config,
        makeFedOptions(),
        []
      );

      expect(names(result.outputFiles)).toEqual(['Comp.js', chunk].sort());
    });

    it('reports file names inside an absolute output path', async () => {
      const io = createMemoryIo();
      const adapter = createFakeBuildAdapter({
        io,
        results: [{ fileName: '/out/dist/Comp.js' }, { fileName: '/out/dist/chunk-AAAAAAAA.js' }],
      });

      const result = await bundleExposedAndMappingsCore(
        { adapter, io },
        makeConfig({ exposes: { './Comp': { file: './src/comp.ts' } }, chunks: true }),
        makeFedOptions({ outputPath: '/out/dist' }),
        []
      );

      expect(names(result.outputFiles)).toEqual([
        'Comp.js',
        expect.stringMatching(/^chunk-[A-Z2-7]{8}\.js$/),
      ]);
    });

    // A name relative to outdir used to fail with a bare ENOENT in the chunk rewrite.
    it('rejects a relative fileName from the adapter', async () => {
      const io = createMemoryIo()
        .setFile('/ws/dist/Comp.js', "export * from './chunk-AAAAAAAA.js';\n")
        .setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
      const adapter = createFakeBuildAdapter({
        results: [{ fileName: 'Comp.js' }, { fileName: 'chunk-AAAAAAAA.js' }],
      });
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);

      await expect(
        bundleExposedAndMappingsCore(
          { adapter, io },
          makeConfig({
            exposes: { './Comp': { file: './src/comp.ts' } },
            chunks: true,
            features: { ...makeConfig().features, integrityHashes: true },
          }),
          makeFedOptions(),
          []
        )
      ).rejects.toThrow("NFBuildAdapter.build returned a relative fileName 'Comp.js'");
    });

    const chunkedComp = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      chunks: true,
    });

    // A chunk in assets/ would be renamed there and published under `chunks` by a name that is not
    // in the output folder.
    it('rejects a chunk written into a subfolder of outdir', async () => {
      const io = createMemoryIo()
        .setFile('/ws/dist/Comp.js', "export * from './assets/chunk-AAAAAAAA.js';\n")
        .setFile('/ws/dist/assets/chunk-AAAAAAAA.js', 'export const a = 1;\n');
      const adapter = createFakeBuildAdapter({
        results: [
          { fileName: '/ws/dist/Comp.js' },
          { fileName: '/ws/dist/assets/chunk-AAAAAAAA.js' },
        ],
      });

      await expect(
        bundleExposedAndMappingsCore({ adapter, io }, chunkedComp, makeFedOptions(), [])
      ).rejects.toThrow(
        "NFBuildAdapter.build returned '/ws/dist/assets/chunk-AAAAAAAA.js', missing from outdir '/ws/dist'"
      );
    });

    // An adapter may skip re-emitting an unchanged chunk but still report it; core already renamed
    // it by content, so the rewrite used to fail with a bare ENOENT.
    it('rejects a rebuild that reports a chunk it did not write', async () => {
      const io = createMemoryIo();
      let builds = 0;
      const adapter = createFakeBuildAdapter({
        results: () => {
          if (builds++ === 0) {
            io.setFile('/ws/dist/Comp.js', "export * from './chunk-AAAAAAAA.js';\n");
            io.setFile('/ws/dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
          }
          return [{ fileName: '/ws/dist/Comp.js' }, { fileName: '/ws/dist/chunk-AAAAAAAA.js' }];
        },
      });
      const fedOptions = makeFedOptions();

      await bundleExposedAndMappingsCore({ adapter, io }, chunkedComp, fedOptions, []);
      await expect(
        bundleExposedAndMappingsCore(
          { adapter, io },
          chunkedComp,
          fedOptions,
          [],
          ['/ws/src/comp.ts']
        )
      ).rejects.toThrow(
        "NFBuildAdapter.build returned '/ws/dist/chunk-AAAAAAAA.js', missing from outdir '/ws/dist'"
      );
    });
  });

  it('skips setup and forwards modifiedFiles on a rebuild', async () => {
    const adapter = createFakeBuildAdapter({ results: [{ fileName: '/ws/dist/Comp.js' }] });
    const config = makeConfig({ exposes: { './Comp': { file: './src/comp.ts' } } });
    const fedOptions = makeFedOptions();

    // The full build sets the context up; the fake, like a real adapter, rejects a build without one.
    await bundleExposedAndMappingsCore({ adapter }, config, fedOptions, []);
    await bundleExposedAndMappingsCore({ adapter }, config, fedOptions, [], ['/ws/src/x.ts']);

    expect(adapter.calls.setup).toHaveLength(1);
    expect(adapter.calls.build.at(-1)!.modifiedFiles).toEqual(['/ws/src/x.ts']);
  });

  it('throws before invoking the adapter when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createFakeBuildAdapter();

    await expect(
      bundleExposedAndMappingsCore(
        { adapter },
        makeConfig(),
        makeFedOptions(),
        [],
        undefined,
        controller.signal
      )
    ).rejects.toThrow(/Aborted before bundling/);
    expect(adapter.calls.build).toHaveLength(0);
  });
});

// Pins the mapping output of every build mode without declared packages (core#198): such a config
// must keep these bundles, `bundle` fields and published records.
describe('mapping output without declared packages', () => {
  const cfg = { singleton: true, strictVersion: false };
  // Shaped like discussion #176: domain-named libraries that the name rule groups by their first
  // two segments, a library next to its own secondary, one mapping in each other build mode, and a
  // package whose entries land in two bundles (`@org/b` on its own, `@org/b/extra` in the default).
  const config = () =>
    makeConfig({
      chunks: true,
      sharedMappings: {
        './libs/components/table': '@shared/components/table',
        './libs/components/collapse': '@shared/components/collapse',
        './libs/lib': '@org/lib',
        './libs/lib/testing': '@org/lib/testing',
        './libs/b': '@org/b',
        './libs/b/extra': '@org/b/extra',
        './libs/c/x': '@org/c/x',
        './libs/c/y': '@org/c/y',
      },
      sharedMappingsConfig: {
        '@org/b': { ...cfg, build: 'separate' },
        '@org/c/*': { ...cfg, build: 'package' },
      },
    });

  async function build() {
    const io = createMemoryIo();
    const adapter = createFakeBuildAdapter({ io });
    const fedOptions = makeFedOptions({ dev: false });
    const artifactInfo = await bundleExposedAndMappingsCore(
      { adapter, io },
      config(),
      fedOptions,
      []
    );
    const info = assembleFederationInfo(config(), fedOptions, artifactInfo);
    return { adapter, artifactInfo, info };
  }

  it('plans the bundles', async () => {
    const { adapter } = await build();

    expect(
      adapter.calls.setup.map(c => [
        c.name,
        c.options.chunks,
        c.options.entryPoints.map(ep => ep.outName),
      ])
    ).toEqual([
      [
        'mapping-bundle',
        true,
        [
          '_shared_components_table.js',
          '_shared_components_collapse.js',
          '_org_lib.js',
          '_org_lib_testing.js',
          '_org_b_extra.js',
        ],
      ],
      ['mapping-org_b', true, ['_org_b.js']],
      ['mapping-org_c', true, ['_org_c_x.js', '_org_c_y.js']],
    ]);
  });

  // A mapping package built in two chunked bundles publishes two records under one name, while the
  // bundle that splits them stays off the wire.
  it('splits dense records by bundle', async () => {
    const { info } = await build();

    expect(info.shared.map(s => [s.packageName, Object.keys(s.entries)])).toEqual([
      ['@shared/components', ['@shared/components/table', '@shared/components/collapse']],
      ['@org/lib', ['@org/lib', '@org/lib/testing']],
      ['@org/b', ['@org/b/extra']],
      ['@org/b', ['@org/b']],
      ['@org/c', ['@org/c/x', '@org/c/y']],
    ]);
    for (const record of info.shared) expect(record).not.toHaveProperty('bundle');
  });
});

// End to end through bundling and remoteEntry.json assembly; `@org/lib` is #213's Nx layout, an
// exact tsconfig key per entry point joined by one declaration.
describe('mapping output with declared packages', () => {
  const pkg: NormalizedMappingConfig = { singleton: true, strictVersion: false };
  const config = () =>
    makeConfig({
      chunks: true,
      sharedMappings: {
        './libs/components/table': '@shared/components/table',
        './libs/components/collapse': '@shared/components/collapse',
        './libs/lib': '@org/lib',
        './libs/lib/testing': '@org/lib/testing',
        './libs/library': '@org/library',
      },
      sharedMappingsConfig: { '*': pkg },
      sharedMappingPackages: {
        '@shared/components/table': pkg,
        '@shared/components/collapse': pkg,
        '@org/lib': pkg,
      },
    });

  async function build() {
    const io = createMemoryIo();
    const adapter = createFakeBuildAdapter({ io });
    const fedOptions = makeFedOptions({ dev: false });
    const cfg = config();
    const artifactInfo = await bundleExposedAndMappingsCore({ adapter, io }, cfg, fedOptions, []);
    return { adapter, info: assembleFederationInfo(cfg, fedOptions, artifactInfo) };
  }

  it('bundles declared packages with the other mappings', async () => {
    const { adapter } = await build();

    expect(
      adapter.calls.setup.map(c => [
        c.name,
        c.options.chunks,
        c.options.entryPoints.map(ep => ep.outName),
      ])
    ).toEqual([
      [
        'mapping-bundle',
        true,
        [
          '_shared_components_table.js',
          '_shared_components_collapse.js',
          '_org_lib.js',
          '_org_lib_testing.js',
          '_org_library.js',
        ],
      ],
    ]);
  });

  it('publishes one dense record per declared package', async () => {
    const { info } = await build();

    expect(info.shared.map(s => ('entries' in s ? [s.packageName, s.entries] : s))).toEqual([
      ['@shared/components/table', { '@shared/components/table': '_shared_components_table.js' }],
      [
        '@shared/components/collapse',
        { '@shared/components/collapse': '_shared_components_collapse.js' },
      ],
      ['@org/lib', { '@org/lib': '_org_lib.js', '@org/lib/testing': '_org_lib_testing.js' }],
      ['@org/library', { '@org/library': '_org_library.js' }],
    ]);
  });

  // The config is one per package, but each entry point reads its version from its own
  // package.json; a mismatch has to fail before anything is written.
  describe('versions', () => {
    async function buildVersions(testingPackageJson: string) {
      const io = createMemoryIo()
        .setFile('/ws/libs/lib/package.json', JSON.stringify({ version: '1.0.0' }))
        .setFile('/ws/libs/lib/index.ts', '')
        .setFile('/ws/libs/lib/testing/package.json', testingPackageJson)
        .setFile('/ws/libs/lib/testing/index.ts', '');
      const adapter = createFakeBuildAdapter({ io });
      const cfg = makeConfig({
        sharedMappings: {
          '/ws/libs/lib/index.ts': '@org/lib',
          '/ws/libs/lib/testing/index.ts': '@org/lib/testing',
        },
        sharedMappingPackages: { '@org/lib': pkg },
        features: { ...makeConfig().features, mappingVersion: true },
      });
      const fedOptions = makeFedOptions({ dev: false, workspaceRoot: '/ws' });
      const run = bundleExposedAndMappingsCore({ adapter, io }, cfg, fedOptions, []);
      return { adapter, run };
    }

    it('rejects a declared package whose entry points read different versions', async () => {
      const { adapter, run } = await buildVersions(JSON.stringify({ version: '2.0.0' }));

      await expect(run).rejects.toThrow(
        /'@org\/lib' and '@org\/lib\/testing' belong to declared package '@org\/lib' but publish different metadata \(requiredVersion: "~1\.0\.0" vs "~2\.0\.0", version: "1\.0\.0" vs "2\.0\.0"\)/
      );
      expect(adapter.calls.setup).toEqual([]);
    });

    it('builds a declared package whose entry points agree', async () => {
      const { run } = await buildVersions(JSON.stringify({ version: '1.0.0' }));
      await expect(run).resolves.toBeDefined();
    });

    // The check and the published record share one read of each package.json.
    it('warns once about a malformed package.json', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const { run } = await buildVersions('{ not json');
      await run.catch(() => undefined);

      expect(warn.mock.calls.filter(([m]) => String(m).includes('Failed to parse'))).toHaveLength(
        1
      );
    });
  });
});
