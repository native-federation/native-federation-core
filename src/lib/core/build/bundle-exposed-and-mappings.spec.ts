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
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
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
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse')
    );
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

function makeConfig(overrides: Partial<NormalizedFederationConfig> = {}): NormalizedFederationConfig {
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
      denseExternals: false,
      integrityHashes: false,
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

    const result = await bundleExposedAndMappingsCore(
      { adapter },
      config,
      makeFedOptions(),
      ['rxjs']
    );

    expect(result.exposes).toEqual([
      expect.objectContaining({ key: './Comp', outFileName: 'Comp.js' }),
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({ packageName: 'foo', outFileName: 'foo.js' }),
    ]);
    expect(adapter.calls.setup).toHaveLength(1);
    expect(adapter.calls.build).toHaveLength(1);
  });

  it('skips setup and forwards modifiedFiles on a rebuild', async () => {
    const adapter = createFakeBuildAdapter({ results: [] });

    await bundleExposedAndMappingsCore({ adapter }, makeConfig(), makeFedOptions(), [], [
      '/ws/src/x.ts',
    ]);

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
