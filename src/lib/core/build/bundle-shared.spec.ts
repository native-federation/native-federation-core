import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { bundleSharedCore, calcHashCore } from './bundle-shared.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { createFakeBuildAdapter } from './__test-helpers__/fake-build-adapter.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
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

// bundle-shared reads the lib's own package.json (../../../package.json relative
// to the module) for the cache config-state; this spec sits in the same folder.
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
    skip: prepareSkipList([]),
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      integrityHashes: false,
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
});
