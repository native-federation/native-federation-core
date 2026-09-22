import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  bundleExposedAndMappingsCore,
  getMappingVersion,
  getMappingVersionCore,
} from './bundle-exposed-and-mappings.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { createFakeBuildAdapter } from './__test-helpers__/fake-build-adapter.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { logger } from '../../utils/logger.js';
import type {
  NormalizedFederationConfig,
  NormalizedMappingConfig,
} from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';

describe('getMappingVersion', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mapping-version-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function write(relPath: string, contents: string) {
    const full = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
    return full;
  }

  it('returns version from the nearest package.json walking up from a deep entry', () => {
    write('libs/shared/package.json', JSON.stringify({ version: '1.2.3' }));
    const entry = write('libs/shared/src/lib/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('1.2.3');
  });

  it('returns version when package.json sits next to the entry file', () => {
    write('libs/shared/package.json', JSON.stringify({ version: '4.5.6' }));
    const entry = write('libs/shared/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('4.5.6');
  });

  it('falls back to the workspace package.json when no closer one is found', () => {
    write('package.json', JSON.stringify({ version: '9.9.9' }));
    const entry = write('libs/shared/src/lib/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('9.9.9');
  });

  it('skips a package.json without a version and keeps walking up', () => {
    write('libs/shared/package.json', JSON.stringify({ name: 'shared' }));
    write('package.json', JSON.stringify({ version: '7.0.0' }));
    const entry = write('libs/shared/src/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('7.0.0');
  });

  it('returns "" and warns when a package.json is malformed', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    write('libs/shared/package.json', '{ not json');
    const entry = write('libs/shared/src/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
  });

  it('returns "" when no package.json exists at or above the entry within the workspace', () => {
    const entry = write('libs/shared/src/index.ts', '');

    expect(getMappingVersion(entry, tmpRoot)).toBe('');
  });

  it('does not walk above workspaceRoot', () => {
    const outerVersion = JSON.stringify({ version: 'should-not-be-used' });
    const outer = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mapping-version-outer-'));
    fs.writeFileSync(path.join(outer, 'package.json'), outerVersion);
    const innerRoot = path.join(outer, 'workspace');
    fs.mkdirSync(innerRoot);
    const entry = path.join(innerRoot, 'libs/shared/src/index.ts');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');

    try {
      expect(getMappingVersion(entry, innerRoot)).toBe('');
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe('getMappingVersionCore', () => {
  it('returns the version from the nearest package.json walking up', () => {
    const io = createMemoryIo()
      .setFile('/ws/libs/shared/package.json', JSON.stringify({ version: '1.2.3' }))
      .setFile('/ws/libs/shared/src/lib/index.ts', '');
    expect(getMappingVersionCore(io, '/ws/libs/shared/src/lib/index.ts', '/ws')).toBe('1.2.3');
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
      denseChunking: false,
      denseExternals: false,
      integrityHashes: false,
      synthesizeCjsExports: true,
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
    expect(adapter.calls.setup).toHaveLength(1);
    expect(adapter.calls.build).toHaveLength(1);
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

  it('names dense chunks after their content and points the rewritten entries at them', async () => {
    const io = createMemoryIo();
    const config = makeConfig({
      exposes: { './Comp': { file: './src/comp.ts' } },
      chunks: true,
      features: { ...makeConfig().features, denseChunking: true },
    });
    const adapter = createFakeBuildAdapter({
      results: () => {
        io.setFile('dist/Comp.js', "export * from './chunk-AAAAAAAA.js';\n");
        io.setFile('dist/chunk-AAAAAAAA.js', 'export const a = 1;\n');
        return [{ fileName: 'dist/Comp.js' }, { fileName: 'dist/chunk-AAAAAAAA.js' }];
      },
    });

    const result = await bundleExposedAndMappingsCore(
      { adapter, io },
      config,
      makeFedOptions(),
      []
    );

    const [chunk] = result.chunks!['mapping-or-exposed']!;
    expect(chunk).toMatch(/^chunk-[A-Z2-7]{8}\.js$/);
    expect(chunk).not.toBe('chunk-AAAAAAAA.js');
    expect(io.isFile(`dist/${chunk}`)).toBe(true);
    expect(io.isFile('dist/chunk-AAAAAAAA.js')).toBe(false);
    expect(io.readText('dist/Comp.js')).toContain(`@nf-internal/${chunk!.replace(/\.js$/, '')}`);
    expect(io.readText('dist/Comp.js')).not.toContain('AAAAAAAA');
  });

  it('skips setup and forwards modifiedFiles on a rebuild', async () => {
    const adapter = createFakeBuildAdapter({ results: [] });

    await bundleExposedAndMappingsCore(
      { adapter },
      makeConfig(),
      makeFedOptions(),
      [],
      ['/ws/src/x.ts']
    );

    expect(adapter.calls.setup).toHaveLength(0);
    expect(adapter.calls.build[0]!.modifiedFiles).toEqual(['/ws/src/x.ts']);
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
