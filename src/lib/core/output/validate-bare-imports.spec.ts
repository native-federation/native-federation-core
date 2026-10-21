import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  FederationInfo,
  OutputFile,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
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

// The files the build reported writing; what is scanned no longer depends on remoteEntry.json.
const browser = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'browser' }));
const node = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'node' }));

const unresolvedImports = (...args: Parameters<typeof findUnresolvedImportsCore>) =>
  findUnresolvedImportsCore(...args).unresolved;

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

    const result = unresolvedImports(
      io,
      OUT,
      browser(
        '_angular_animations.js',
        '_angular_core.js',
        '_angular_platform_browser_animations_async.js'
      ),
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

    const [unresolved, ...rest] = unresolvedImports(
      io,
      OUT,
      browser('_angular_platform_browser.js'),
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

    const result = unresolvedImports(
      io,
      OUT,
      browser('a.js'),
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

    const result = unresolvedImports(
      io,
      OUT,
      browser('Component.js'),
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

    const result = unresolvedImports(
      io,
      OUT,
      browser('main.js', 'chunk-A.js', 'chunk-B.js'),
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

    const result = unresolvedImports(
      io,
      OUT,
      browser('main.js'),
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

    const result = unresolvedImports(
      io,
      OUT,
      [...browser('browser-lib.js'), ...node('node-lib.js', 'node-chunk.js')],
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

  // core#177: without denseChunking a mapping's chunk is imported relatively, so remoteEntry.json
  // never names it. It is scanned because the build reported writing it.
  it('scans a non-dense mapping chunk that remoteEntry.json does not name', () => {
    const io = createMemoryIo()
      .setFile(out('_my_org_ui.js'), `export * from "./chunk-UI.js";`)
      .setFile(out('chunk-UI.js'), `import "@angular/cdk/overlay";`);

    const result = unresolvedImports(
      io,
      OUT,
      browser('_my_org_ui.js', 'chunk-UI.js'),
      makeConfig({ shared: { '@angular/cdk': ext() } }),
      info({ shared: [shared('@my-org/ui', '_my_org_ui.js'), shared('@angular/cdk', 'cdk.js')] })
    );

    expect(result).toEqual([
      expect.objectContaining({ specifier: '@angular/cdk/overlay', importers: ['chunk-UI.js'] }),
    ]);
  });

  it('allows a Node built-in by the platform of the file that imports it', () => {
    const io = createMemoryIo()
      .setFile(out('chunk-N.js'), `import "crypto";`)
      .setFile(out('chunk-B.js'), `import "crypto";`);

    const result = unresolvedImports(
      io,
      OUT,
      [...node('chunk-N.js'), ...browser('chunk-B.js')],
      // A node external elsewhere in the build no longer lets every browser chunk through.
      makeConfig({ shared: { 'node-lib': ext({ platform: 'node' }) } }),
      info()
    );

    expect(result.map(r => [r.specifier, r.importers])).toEqual([['crypto', ['chunk-B.js']]]);
  });

  it('points a subpath of a shared mapping at the mapping', () => {
    const io = createMemoryIo().setFile(out('Component.js'), `import "@my-org/ui/button";`);

    const [unresolved] = unresolvedImports(
      io,
      OUT,
      browser('Component.js'),
      makeConfig({ sharedMappings: { '/ws/libs/ui/index.ts': '@my-org/ui' } }),
      info({
        shared: [shared('@my-org/ui', '_my_org_ui.js')],
        exposes: [{ key: './Component', outFileName: 'Component.js' }],
      })
    );

    expect(unresolved!.reason).toContain("subpath of the shared mapping '@my-org/ui'");
  });

  it('lists every importer once and scans only JavaScript', () => {
    const io = createMemoryIo()
      .setFile(out('a.js'), `import "missing"; import "missing";`)
      .setFile(out('b.js'), `import "missing";`)
      // Both would lex as an import, so they are left out only because they are not scripts.
      .setFile(out('styles.css'), `import "missing";`)
      .setFile(out('a.js.map'), `import "missing";`);

    const result = findUnresolvedImportsCore(
      io,
      OUT,
      browser('a.js', 'b.js', 'styles.css', 'a.js.map'),
      makeConfig(),
      info({
        shared: [shared('a', 'a.js'), shared('b', 'b.js'), shared('s', 'styles.css')],
      })
    );

    expect(result).toEqual({
      unresolved: [expect.objectContaining({ specifier: 'missing', importers: ['a.js', 'b.js'] })],
      unparsable: [],
      missing: [],
    });
  });

  // An adapter that writes into a subfolder reports a basename that is not in the output folder;
  // that file used to be skipped without a word.
  it('reports a written script that is not in the output folder', () => {
    const io = createMemoryIo().setFile(out('chunks/chunk-A.js'), `import "missing";`);

    const result = findUnresolvedImportsCore(io, OUT, browser('chunk-A.js'), makeConfig(), info());

    expect(result).toEqual({ unresolved: [], unparsable: [], missing: ['chunk-A.js'] });
  });

  // Valid JS the lexer misreads: '/' after a block starts a regex, not a division.
  it('reports a script the lexer cannot parse instead of passing it', () => {
    const io = createMemoryIo().setFile(out('a.js'), '{}/`/;import "missing";');

    const { unresolved, unparsable } = findUnresolvedImportsCore(
      io,
      OUT,
      browser('a.js'),
      makeConfig(),
      info()
    );

    expect(unresolved).toEqual([]);
    expect(unparsable).toEqual([{ fileName: 'a.js', error: expect.any(String) }]);
  });
});

describe('validateBareImports', () => {
  let workspaceRoot: string | undefined;
  afterEach(() => {
    vi.restoreAllMocks();
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  });

  function setup(strictImports: boolean) {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-validate-'));
    fs.mkdirSync(path.join(workspaceRoot, 'dist'));
    fs.writeFileSync(path.join(workspaceRoot, 'dist', 'a.js'), `import "@angular/common/http";`);
    const config = makeConfig({ shared: { '@angular/common': ext() } });
    config.features.strictImports = strictImports;
    const fedOptions = { workspaceRoot, outputPath: 'dist' } as NormalizedFederationOptions;
    const fedInfo = info({ shared: [shared('@angular/common', 'a.js')] });
    return { config, fedOptions, fedInfo, files: browser('a.js') };
  }

  it('warns by default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(false);

    expect(() => validateBareImports(config, fedOptions, fedInfo, files)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'a.js' imports '@angular/common/http'")
    );
  });

  it('fails the build with strictImports', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(true);

    expect(() => validateBareImports(config, fedOptions, fedInfo, files)).toThrow(/strictImports/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('@angular/common/http'));
  });

  it('fails the build on an import that only a non-dense chunk makes', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, files } = setup(true);
    const dist = path.join(fedOptions.workspaceRoot, 'dist');
    fs.writeFileSync(path.join(dist, 'a.js'), `export * from "./chunk-X.js";`);
    fs.writeFileSync(path.join(dist, 'chunk-X.js'), `import "lodash";`);
    const fedInfo = info({ shared: [shared('@angular/common', 'a.js')] });

    expect(() =>
      validateBareImports(config, fedOptions, fedInfo, [...files, ...browser('chunk-X.js')])
    ).toThrow(/1 bare import/);
  });

  // Real files: the memory IO decodes with TextDecoder, which drops the BOM, while nodeIo keeps it
  // and es-module-lexer then finds no import that follows it directly.
  it('reads the imports of a script that starts with a BOM', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(false);
    fs.writeFileSync(
      path.join(fedOptions.workspaceRoot, 'dist', 'a.js'),
      '\uFEFFimport "@angular/common/http";'
    );

    validateBareImports(config, fedOptions, fedInfo, files);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'a.js' imports '@angular/common/http'")
    );
  });

  it('warns about a file it could not scan, and fails the build on it with strictImports', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(false);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), '{}/`/;import "x";');

    expect(() => validateBareImports(config, fedOptions, fedInfo, files)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not scan the imports of 'a.js'")
    );

    config.features.strictImports = true;
    expect(() => validateBareImports(config, fedOptions, fedInfo, files)).toThrow(
      /^1 file\(s\) could not be scanned \(features.strictImports\)/
    );
  });

  it('logs a file it could not scan as an error with strictImports', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(true);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), '{}/`/;import "x";');

    expect(() => validateBareImports(config, fedOptions, fedInfo, files)).toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Could not scan the imports of 'a.js'")
    );
    expect(warn).not.toHaveBeenCalled();
  });

  // A missing file is the adapter breaking the outputFiles contract; failing strict builds on it
  // would be new in a minor.
  it('only warns about a reported file that is missing, even with strictImports', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(true);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), `export {};`);

    expect(() =>
      validateBareImports(config, fedOptions, fedInfo, browser('a.js', 'ghost.js'))
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Reported as written but not in .*, so not scanned: 'ghost.js'\./)
    );
  });

  // An adapter writing into a subfolder misses every script, so one line per file would flood
  // each rebuild.
  it('reports every missing file in one warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(false);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), `export {};`);

    validateBareImports(config, fedOptions, fedInfo, browser('a.js', 'ghost.js', 'ghost2.js'));

    const missingWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('Reported as written')
    );
    expect(missingWarnings).toEqual([
      [expect.stringMatching(/so not scanned: 'ghost.js', 'ghost2.js'\./)],
    ]);
  });

  it('names both problems when a strict build has an unresolved import and an unscanned file', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(true);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'b.js'), '{}/`/;import "x";');

    expect(() => validateBareImports(config, fedOptions, fedInfo, browser('a.js', 'b.js'))).toThrow(
      /^1 bare import\(s\) cannot be resolved from remoteEntry.json and 1 file\(s\) could not be scanned/
    );
  });
});
