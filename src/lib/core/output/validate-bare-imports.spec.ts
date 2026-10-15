import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FederationInfo, SharedInfo } from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../../domain/config/external-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { prepareSkipList } from '../../config/default-skip-list.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../../utils/logger.js';
import { findUnresolvedImportsCore, validateBareImports } from './validate-bare-imports.js';

const OUT = path.resolve('/ws/dist');
const out = (file: string) => path.join(OUT, file);

function shared(packageName: string, outFileName: string): SharedInfo {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    version: '1.0.0',
    packageName,
    outFileName,
  };
}

function ext(overrides: Partial<NormalizedExternalConfig> = {}): NormalizedExternalConfig {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    chunks: true,
    platform: 'browser',
    build: 'default',
    ...overrides,
  } as NormalizedExternalConfig;
}

function makeConfig(
  overrides: Partial<NormalizedFederationConfig> = {}
): NormalizedFederationConfig {
  return {
    $type: 'classic',
    name: 'host',
    exposes: {},
    shared: {},
    sharedMappings: {},
    sharedMappingsConfig: {},
    skip: prepareSkipList([]),
    chunks: true,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: true,
      denseChunking: false,
      denseExternals: false,
      integrityHashes: false,
      synthesizeCjsExports: true,
      strictImports: false,
    },
    ...overrides,
  };
}

function info(overrides: Partial<FederationInfo> = {}): FederationInfo {
  return { name: 'host', shared: [], exposes: [], ...overrides };
}

describe('findUnresolvedImportsCore', () => {
  // core#168 case 1: provideAnimationsAsync() lazily imports a secondary the scan pruned.
  it('reports a lazily imported secondary of a shared package that was not published', () => {
    const io = createMemoryIo()
      .setFile(
        out('_angular_platform_browser_animations_async.js'),
        `import "@angular/core"; const l = () => import("@angular/animations/browser");`
      )
      .setFile(out('_angular_animations.js'), `export const a = 1;`)
      .setFile(out('_angular_core.js'), `export const c = 1;`);
    const config = makeConfig({
      shared: {
        '@angular/animations': ext(),
        '@angular/core': ext(),
        '@angular/platform-browser/animations/async': ext(),
      },
    });

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      config,
      info({
        shared: [
          shared('@angular/animations', '_angular_animations.js'),
          shared('@angular/core', '_angular_core.js'),
          shared(
            '@angular/platform-browser/animations/async',
            '_angular_platform_browser_animations_async.js'
          ),
        ],
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      specifier: '@angular/animations/browser',
      importers: ['_angular_platform_browser_animations_async.js'],
    });
    expect(result[0]!.reason).toContain(
      "includeSecondaries: { keepAll: true } on '@angular/animations'"
    );
  });

  // core#168 case 2: a skipped secondary stays external because its root is shared.
  it('names the skip list when a skipped secondary is still imported', () => {
    const io = createMemoryIo().setFile(
      out('_angular_platform_browser.js'),
      `import { x } from "@angular/common/http"; import "@angular/common";`
    );
    const config = makeConfig({
      shared: { '@angular/common': ext(), '@angular/platform-browser': ext() },
      skip: prepareSkipList(['@angular/common/http']),
    });

    const [unresolved, ...rest] = findUnresolvedImportsCore(
      io,
      OUT,
      config,
      info({
        shared: [
          shared('@angular/common', '_angular_common.js'),
          shared('@angular/platform-browser', '_angular_platform_browser.js'),
        ],
      })
    );

    expect(rest).toEqual([]);
    expect(unresolved!.specifier).toBe('@angular/common/http');
    expect(unresolved!.reason).toContain(
      "It is skipped, but stays external because '@angular/common' is shared"
    );
  });

  it('accepts every key a dense group declares', () => {
    const io = createMemoryIo().setFile(
      out('a.js'),
      `import "@angular/common/http"; import "@angular/common";`
    );

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig(),
      info({
        shared: [
          {
            singleton: true,
            strictVersion: true,
            requiredVersion: '^1.0.0',
            packageName: '@angular/common',
            entries: { '@angular/common': 'a.js', '@angular/common/http': 'b.js' },
          },
        ],
      })
    );

    expect(result).toEqual([]);
  });

  // `externals` is the opt-out: kept as an import, never published, provided by someone else.
  it('lets externals opt out, with the subpath and wildcard matching esbuild uses', () => {
    const io = createMemoryIo().setFile(
      out('Component.js'),
      `import "host-sdk"; import "host-sdk/events"; import "@icons/home.svg"; import "other";`
    );

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig({ externals: ['host-sdk', '@icons/*.svg'] }),
      info({ exposes: [{ key: './Component', outFileName: 'Component.js' }] })
    );

    expect(result.map(r => r.specifier)).toEqual(['other']);
    expect(result[0]!.reason).toContain("list it in 'externals'");
  });

  it('accepts dense chunks and chunks published as externals', () => {
    const io = createMemoryIo()
      .setFile(out('main.js'), `import "@nf-internal/chunk-A"; import "@nf-internal/chunk-B";`)
      .setFile(out('chunk-A.js'), `export {};`)
      .setFile(out('chunk-B.js'), `export {};`);

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig(),
      info({
        shared: [shared('@nf-internal/chunk-B', 'chunk-B.js')],
        exposes: [{ key: './main', outFileName: 'main.js' }],
        chunks: { 'browser-shared': ['chunk-A.js'] },
      })
    );

    expect(result).toEqual([]);
  });

  it('ignores relative, absolute, URL and computed specifiers', () => {
    const io = createMemoryIo().setFile(
      out('main.js'),
      `import "./x.js"; import "/abs.js"; import "https://cdn.example/x.js";
       const f = n => import(n); console.log(import.meta.url);`
    );

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig(),
      info({ exposes: [{ key: './main', outFileName: 'main.js' }] })
    );

    expect(result).toEqual([]);
  });

  it('reports a Node built-in in a browser bundle and allows it in a node one', () => {
    const io = createMemoryIo()
      .setFile(out('browser-lib.js'), `import "fs"; import "node:path";`)
      .setFile(out('node-lib.js'), `import "fs"; import "node:path";`)
      .setFile(out('node-chunk.js'), `import "crypto";`);
    const config = makeConfig({
      shared: { 'browser-lib': ext(), 'node-lib': ext({ platform: 'node' }) },
    });

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      config,
      info({
        shared: [shared('browser-lib', 'browser-lib.js'), shared('node-lib', 'node-lib.js')],
        chunks: { 'node-node_lib': ['node-chunk.js'] },
      })
    );

    expect(result.map(r => [r.specifier, r.importers])).toEqual([
      ['fs', ['browser-lib.js']],
      ['node:path', ['browser-lib.js']],
    ]);
    expect(result[0]!.reason).toContain('Node.js built-in');
  });

  it('points a subpath of a shared mapping at the mapping', () => {
    const io = createMemoryIo().setFile(out('Component.js'), `import "@my-org/ui/button";`);

    const [unresolved] = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig({ sharedMappings: { '/ws/libs/ui/index.ts': '@my-org/ui' } }),
      info({
        shared: [shared('@my-org/ui', '_my_org_ui.js')],
        exposes: [{ key: './Component', outFileName: 'Component.js' }],
      })
    );

    expect(unresolved!.reason).toContain("subpath of the shared mapping '@my-org/ui'");
  });

  it('lists every importer once and skips files that are missing or not JavaScript', () => {
    const io = createMemoryIo()
      .setFile(out('a.js'), `import "missing"; import "missing";`)
      .setFile(out('b.js'), `import "missing";`)
      .setFile(out('styles.css'), `@import "missing";`);

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      makeConfig(),
      info({
        shared: [
          shared('a', 'a.js'),
          shared('b', 'b.js'),
          shared('c', 'c.js'),
          shared('s', 'styles.css'),
        ],
      })
    );

    expect(result).toEqual([
      expect.objectContaining({ specifier: 'missing', importers: ['a.js', 'b.js'] }),
    ]);
  });
});

describe('validateBareImports', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(strictImports: boolean) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-validate-'));
    fs.mkdirSync(path.join(workspaceRoot, 'dist'));
    fs.writeFileSync(path.join(workspaceRoot, 'dist', 'a.js'), `import "@angular/common/http";`);
    const config = makeConfig({ shared: { '@angular/common': ext() } });
    config.features.strictImports = strictImports;
    const fedOptions = { workspaceRoot, outputPath: 'dist' } as NormalizedFederationOptions;
    const fedInfo = info({ shared: [shared('@angular/common', 'a.js')] });
    return { config, fedOptions, fedInfo };
  }

  it('warns by default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(false);

    expect(() => validateBareImports(config, fedOptions, fedInfo)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'a.js' imports '@angular/common/http'")
    );
  });

  it('fails the build with strictImports', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(true);

    expect(() => validateBareImports(config, fedOptions, fedInfo)).toThrow(/strictImports/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('@angular/common/http'));
  });
});
