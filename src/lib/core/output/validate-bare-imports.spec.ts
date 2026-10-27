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

const FULL = { fullReport: true };
const REBUILD = { fullReport: false };

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
    expect(unresolved!.reason).toContain("It is in 'skip', but '@angular/common' is shared");
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
  it('lets externals opt out, with subpath and wildcard matching', () => {
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
    expect(result[0]!.reason).toContain("add it to 'externals'");
  });

  it('lets a scoped external cover its subpaths but not a lookalike package', () => {
    const io = createMemoryIo().setFile(
      out('Component.js'),
      `import "@host/sdk/events"; import "@host/sdk-extra";`
    );

    const result = unresolvedImports(
      io,
      OUT,
      browser('Component.js'),
      makeConfig({ externals: ['@host/sdk'] }),
      info({ exposes: [{ key: './Component', outFileName: 'Component.js' }] })
    );

    expect(result.map(r => r.specifier)).toEqual(['@host/sdk-extra']);
  });

  // Output captured once per bundler from the same entry: hand-written fixtures are not minified,
  // and Rolldown writes the dynamic import as a backtick literal.
  it.each([
    [
      'esbuild 0.28.2',
      'export*from"@angular/common/http";import{a as e}from"@angular/common/testing";import"@angular/common";var o=()=>import("@angular/common/locales/de");export{e as a,o as l};',
    ],
    [
      'rolldown 1.2.14',
      'import{a as e}from"@angular/common/testing";import"@angular/common";export*from"@angular/common/http";const t=()=>import(`@angular/common/locales/de`);export{e as a,t as l};',
    ],
  ])('reads real minified %s output, re-exports and dynamic imports included', (_, bundle) => {
    const io = createMemoryIo().setFile(out('main.js'), bundle);

    const result = unresolvedImports(
      io,
      OUT,
      browser('main.js'),
      makeConfig({ shared: { '@angular/common': ext() } }),
      info({ shared: [shared('@angular/common', 'common.js')] })
    );

    expect(result.map(r => r.specifier)).toEqual([
      '@angular/common/http',
      '@angular/common/locales/de',
      '@angular/common/testing',
    ]);
  });

  // A documented limitation (AGENTS.md, "Unresolvable bare imports"): only ESM imports are read.
  // A bundler's require shim keeps a CommonJS require of an external as a call the lexer never
  // sees, so this pins it: reporting it has to be a deliberate change.
  it('does not report a CommonJS require of an external', () => {
    const bundle =
      'var e=__require("@angular/common/testing");import"@angular/common";export{e as a};';
    const io = createMemoryIo().setFile(out('main.js'), bundle);

    const result = unresolvedImports(
      io,
      OUT,
      browser('main.js'),
      makeConfig({ shared: { '@angular/common': ext() } }),
      info({ shared: [shared('@angular/common', 'common.js')] })
    );

    expect(result).toEqual([]);
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

  // Only an exact built-in name passes in a node file: nothing resolves 'process/browser' there.
  it('reports a node file import that only looks like a built-in', () => {
    const io = createMemoryIo().setFile(
      out('chunk-N.js'),
      `import "fs/promises"; import "process/browser"; import "events/x"; import "node:nope";`
    );

    const result = unresolvedImports(io, OUT, node('chunk-N.js'), makeConfig(), info());

    expect(result.map(r => r.specifier)).toEqual(['events/x', 'node:nope', 'process/browser']);
  });

  // 'buffer' is a built-in and also an npm polyfill; with 'buffer' shared, it is the polyfill.
  it('names a shared package before the built-in reading', () => {
    const io = createMemoryIo().setFile(out('chunk-B.js'), `import "buffer";`);

    const [unresolved] = unresolvedImports(
      io,
      OUT,
      browser('chunk-B.js'),
      makeConfig({ shared: { buffer: ext() } }),
      info()
    );

    expect(unresolved!.reason).toContain("'buffer' is shared, but not this entry point");
  });

  it('offers the npm polyfill reading only for an exact unprefixed built-in name', () => {
    const io = createMemoryIo().setFile(
      out('chunk-B.js'),
      `import "buffer"; import "node:buffer"; import "fs/promises";`
    );

    const result = unresolvedImports(io, OUT, browser('chunk-B.js'), makeConfig(), info());

    expect(result.map(r => [r.specifier, r.reason.includes('npm polyfill')])).toEqual([
      ['buffer', true],
      ['fs/promises', false],
      ['node:buffer', false],
    ]);
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

    expect(unresolved!.reason).toContain("Import the shared mapping '@my-org/ui' itself");
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
    });
  });

  // validateOutputFiles reports it; scanning a same-named file elsewhere would check other bytes.
  it('skips a reported script that is not in the output folder', () => {
    const io = createMemoryIo().setFile(out('chunks/chunk-A.js'), `import "missing";`);

    const result = findUnresolvedImportsCore(io, OUT, browser('chunk-A.js'), makeConfig(), info());

    expect(result).toEqual({ unresolved: [], unparsable: [] });
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
  // A list, since a test may set up two workspaces (one per federation cache).
  const workspaceRoots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of workspaceRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function setup(strictImports: boolean) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-validate-'));
    workspaceRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'dist'));
    fs.writeFileSync(path.join(workspaceRoot, 'dist', 'a.js'), `import "@angular/common/http";`);
    const config = makeConfig({ shared: { '@angular/common': ext() } });
    config.features.strictImports = strictImports;
    const fedOptions = {
      workspaceRoot,
      outputPath: 'dist',
      federationCache: {},
    } as NormalizedFederationOptions;
    const fedInfo = info({ shared: [shared('@angular/common', 'a.js')] });
    return { config, fedOptions, fedInfo, files: browser('a.js') };
  }

  it('warns by default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(false);

    expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'@angular/common/http' will not resolve (imported by 'a.js')")
    );
  });

  it('fails the build with strictImports', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(true);

    expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).toThrow(
      /strictImports/
    );
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
      validateBareImports(config, fedOptions, fedInfo, [...files, ...browser('chunk-X.js')], FULL)
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

    validateBareImports(config, fedOptions, fedInfo, files, FULL);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'@angular/common/http' will not resolve (imported by 'a.js')")
    );
  });

  it('warns about a file it could not scan, and fails the build on it with strictImports', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(false);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), '{}/`/;import "x";');

    expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not scan 'a.js'"));

    config.features.strictImports = true;
    expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).toThrow(
      /^1 file\(s\) could not be scanned \(features.strictImports\)/
    );
  });

  it('logs a file it could not scan as an error with strictImports', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo, files } = setup(true);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'a.js'), '{}/`/;import "x";');

    expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).toThrow(
      /strictImports/
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Could not scan 'a.js'"));
    expect(warn).not.toHaveBeenCalled();
  });

  it('names both problems when a strict build has an unresolved import and an unscanned file', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { config, fedOptions, fedInfo } = setup(true);
    fs.writeFileSync(path.join(fedOptions.workspaceRoot, 'dist', 'b.js'), '{}/`/;import "x";');

    expect(() =>
      validateBareImports(config, fedOptions, fedInfo, browser('a.js', 'b.js'), FULL)
    ).toThrow(
      /^1 bare import\(s\) cannot be resolved from remoteEntry.json and 1 file\(s\) could not be scanned/
    );
  });

  describe('on a rebuild', () => {
    const quiet = () => {
      const spy = (level: 'warn' | 'notice' | 'info') =>
        vi.spyOn(logger, level).mockImplementation(() => undefined);
      return { warn: spy('warn'), notice: spy('notice'), info: spy('info') };
    };
    const writeDist = (root: string, file: string, code: string) =>
      fs.writeFileSync(path.join(root, 'dist', file), code);

    it('only notes findings that did not change', () => {
      const { warn, notice } = quiet();
      const { config, fedOptions, fedInfo, files } = setup(false);

      validateBareImports(config, fedOptions, fedInfo, files, FULL);
      validateBareImports(config, fedOptions, fedInfo, files, REBUILD);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(notice).toHaveBeenCalledWith(
        '1 unresolved bare import(s), unchanged since the last build.'
      );
    });

    // Chunks are named after their content, so an edit renames the importer.
    it('does not repeat a warning because its importer was renamed', () => {
      const { warn } = quiet();
      const { config, fedOptions, fedInfo, files } = setup(false);
      writeDist(fedOptions.workspaceRoot, 'chunk-B.js', `import "@angular/common/http";`);

      validateBareImports(config, fedOptions, fedInfo, files, FULL);
      validateBareImports(config, fedOptions, fedInfo, browser('chunk-B.js'), REBUILD);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('reports every finding again once one changes', () => {
      const { warn } = quiet();
      const { config, fedOptions, fedInfo, files } = setup(false);

      validateBareImports(config, fedOptions, fedInfo, files, FULL);
      writeDist(
        fedOptions.workspaceRoot,
        'a.js',
        `import "@angular/common/http"; import "lodash";`
      );
      validateBareImports(config, fedOptions, fedInfo, files, REBUILD);

      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('says when the findings are resolved, and warns again when one comes back', () => {
      const { warn, info } = quiet();
      const { config, fedOptions, fedInfo, files } = setup(false);

      validateBareImports(config, fedOptions, fedInfo, files, FULL);
      writeDist(fedOptions.workspaceRoot, 'a.js', `export {};`);
      validateBareImports(config, fedOptions, fedInfo, files, REBUILD);
      expect(info).toHaveBeenCalledWith('All bare imports resolve.');

      writeDist(fedOptions.workspaceRoot, 'a.js', `import "@angular/common/http";`);
      validateBareImports(config, fedOptions, fedInfo, files, REBUILD);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('still reports in full on a full build', () => {
      const { warn } = quiet();
      const { config, fedOptions, fedInfo, files } = setup(false);

      validateBareImports(config, fedOptions, fedInfo, files, FULL);
      validateBareImports(config, fedOptions, fedInfo, files, FULL);

      expect(warn).toHaveBeenCalledTimes(2);
    });

    // A strict build fails, so its errors must always be above the thrown message.
    it('reports and fails every strict build', () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const { config, fedOptions, fedInfo, files } = setup(true);

      expect(() => validateBareImports(config, fedOptions, fedInfo, files, FULL)).toThrow();
      expect(() => validateBareImports(config, fedOptions, fedInfo, files, REBUILD)).toThrow(
        /strictImports/
      );
      expect(error).toHaveBeenCalledTimes(2);
    });

    it('keeps the reported findings per federation cache', () => {
      const { warn } = quiet();
      const first = setup(false);
      const second = setup(false);

      validateBareImports(first.config, first.fedOptions, first.fedInfo, first.files, REBUILD);
      validateBareImports(second.config, second.fedOptions, second.fedInfo, second.files, REBUILD);

      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});
