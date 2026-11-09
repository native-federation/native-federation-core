import { describe, expect, it } from 'vitest';
import * as path from 'path';
import type {
  DenseSharedInfo,
  ExposesInfo,
  FederationInfo,
  OutputFile,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import {
  addChunkClosuresCore,
  readStaticImportGraph,
  staticChunkClosure,
} from './chunk-closures.js';

const OUT = path.resolve('/ws/dist');

const browser = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'browser' }));

// Each value is the list of files a key imports; a plain object stands in for the lexed graph.
const graph =
  (edges: Record<string, string[]>) =>
  (fileName: string): string[] =>
    edges[fileName] ?? [];

describe('staticChunkClosure', () => {
  it.each([
    ['no imports', {}, ['entry.js'], []],
    ['a chain', { 'entry.js': ['a.js'], 'a.js': ['b.js'] }, ['entry.js'], ['a.js', 'b.js']],
    [
      'a diamond, deduped',
      { 'entry.js': ['a.js', 'b.js'], 'a.js': ['c.js'], 'b.js': ['c.js'] },
      ['entry.js'],
      ['a.js', 'b.js', 'c.js'],
    ],
    [
      'a cycle',
      { 'entry.js': ['a.js'], 'a.js': ['b.js'], 'b.js': ['a.js'] },
      ['entry.js'],
      ['a.js', 'b.js'],
    ],
    // The runtime fetches the roots themselves; listing them would preload them twice.
    [
      'a chunk importing its root',
      { 'entry.js': ['a.js'], 'a.js': ['entry.js'] },
      ['entry.js'],
      ['a.js'],
    ],
    [
      'several roots, each excluded',
      { 'x.js': ['y.js', 'c.js'], 'y.js': ['d.js'] },
      ['x.js', 'y.js'],
      ['c.js', 'd.js'],
    ],
    [
      'sorted output',
      { 'entry.js': ['z.js', 'a.js', 'm.js'] },
      ['entry.js'],
      ['a.js', 'm.js', 'z.js'],
    ],
  ])('%s', (_name, edges, roots, expected) => {
    expect(staticChunkClosure(roots, graph(edges))).toEqual(expected);
  });
});

describe('readStaticImportGraph', () => {
  const importsOf = (files: Record<string, string>, listed = Object.keys(files)) => {
    const io = createMemoryIo();
    for (const [name, code] of Object.entries(files)) io.setFile(path.join(OUT, name), code);
    return readStaticImportGraph(io, OUT, browser(...listed));
  };

  it('follows a dense chunk import back to its file', () => {
    const of = importsOf({
      'entry.js': `import '@nf-internal/chunk-AB12';`,
      'chunk-AB12.js': '',
    });
    expect(of('entry.js')).toEqual(['chunk-AB12.js']);
  });

  it('follows a relative chunk import', () => {
    const of = importsOf({
      'entry.js': `import { a } from './chunk-AB12.js';`,
      'chunk-AB12.js': 'export const a = 1;',
    });
    expect(of('entry.js')).toEqual(['chunk-AB12.js']);
  });

  // toChunkImport drops any script extension, so the reverse lookup must find an .mjs chunk too.
  it('follows imports to .mjs chunks', () => {
    const of = importsOf({
      'entry.mjs': `import '@nf-internal/chunk-AB12'; import './chunk-CD34.mjs';`,
      'chunk-AB12.mjs': '',
      'chunk-CD34.mjs': '',
    });
    expect(of('entry.mjs')).toEqual(['chunk-AB12.mjs', 'chunk-CD34.mjs']);
  });

  // A lazy route's chunk is only needed once the app navigates there.
  it('skips dynamic imports', () => {
    const of = importsOf({
      'entry.js': `const lazy = () => import('./chunk-LAZY.js');`,
      'chunk-LAZY.js': '',
    });
    expect(of('entry.js')).toEqual([]);
  });

  // The import map resolves bare specifiers, possibly to another build's file.
  it('stops at bare specifiers', () => {
    const of = importsOf({ 'entry.js': `import '@angular/core'; import 'rxjs';` });
    expect(of('entry.js')).toEqual([]);
  });

  it('ignores relative imports of files this build did not write', () => {
    const of = importsOf({ 'entry.js': `import './elsewhere.js'; import './styles.css';` });
    expect(of('entry.js')).toEqual([]);
  });

  it('ignores a file on disk that the output list does not name', () => {
    const of = importsOf({ 'entry.js': `import './stray.js';`, 'stray.js': '' }, ['entry.js']);
    expect(of('entry.js')).toEqual([]);
  });

  // validateBareImports reports an unparsable file; here it only ends the walk.
  it('treats an unparsable file as having no imports', () => {
    const of = importsOf({ 'entry.js': 'import {' });
    expect(of('entry.js')).toEqual([]);
  });

  it('treats a missing file as having no imports', () => {
    const of = importsOf({}, ['entry.js']);
    expect(of('entry.js')).toEqual([]);
  });
});

describe('addChunkClosuresCore', () => {
  const exposed = (key: string, outFileName: string): ExposesInfo => ({ key, outFileName });
  const shared = (
    packageName: string,
    outFileName: string,
    extra: Partial<SharedInfo> = {}
  ): SharedInfo => ({
    singleton: true,
    strictVersion: true,
    requiredVersion: '^1.0.0',
    version: '1.0.0',
    packageName,
    outFileName,
    ...extra,
  });

  function run(files: Record<string, string>, info: Partial<FederationInfo>) {
    const io = createMemoryIo();
    for (const [name, code] of Object.entries(files)) io.setFile(path.join(OUT, name), code);
    const federationInfo: FederationInfo = { name: 'mfe', exposes: [], shared: [], ...info };
    return addChunkClosuresCore(io, OUT, browser(...Object.keys(files)), federationInfo);
  }

  it('lists the chunk closure of each exposed module', () => {
    const result = run(
      {
        'home.js': `import '@nf-internal/chunk-A'; import 'rxjs';`,
        'cart.js': `import './chunk-B.js';`,
        'chunk-A.js': `import '@nf-internal/chunk-B';`,
        'chunk-B.js': '',
      },
      { exposes: [exposed('./Home', 'home.js'), exposed('./Cart', 'cart.js')] }
    );

    expect(result.exposes).toEqual([
      { key: './Home', outFileName: 'home.js', chunks: ['chunk-A.js', 'chunk-B.js'] },
      { key: './Cart', outFileName: 'cart.js', chunks: ['chunk-B.js'] },
    ]);
  });

  it('omits chunks when the closure is empty', () => {
    const result = run(
      { 'home.js': `import 'rxjs';` },
      { exposes: [exposed('./Home', 'home.js')] }
    );
    expect(result.exposes[0]).not.toHaveProperty('chunks');
  });

  it('lists the chunk closure of a flat shared external marked preload', () => {
    const result = run(
      { 'core.js': `import '@nf-internal/chunk-C';`, 'chunk-C.js': '' },
      { shared: [shared('@angular/core', 'core.js', { preload: true })] }
    );
    expect(result.shared[0]).toMatchObject({
      packageName: '@angular/core',
      chunks: ['chunk-C.js'],
    });
  });

  // Flat output, regrouped by a runtime with densifyExternals: differing lists per entry point would
  // split one package into several records, so every entry point carries the package's union.
  it('gives every flat entry point of a preload package the union of the package', () => {
    const result = run(
      {
        'common.js': `import './chunk-C.js';`,
        'http.js': `import './chunk-H.js';`,
        'rx.js': `import './chunk-R.js';`,
        'chunk-C.js': '',
        'chunk-H.js': '',
        'chunk-R.js': '',
      },
      {
        shared: [
          shared('@angular/common', 'common.js', { preload: true }),
          shared('@angular/common/http', 'http.js', { preload: true }),
          shared('rxjs', 'rx.js', { preload: true }),
        ],
      }
    );
    expect(result.shared.map(s => [s.packageName, s.chunks])).toEqual([
      ['@angular/common', ['chunk-C.js', 'chunk-H.js']],
      ['@angular/common/http', ['chunk-C.js', 'chunk-H.js']],
      ['rxjs', ['chunk-R.js']],
    ]);
  });

  // A dense record is one package; its entry points import each other only by bare specifier, so
  // the union of their closures is what preloading the package needs.
  it('unions the closures of a dense record, leaving out its own entry files', () => {
    const dense: DenseSharedInfo = {
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      packageName: '@angular/common',
      preload: true,
      entries: { '@angular/common': 'common.js', '@angular/common/http': 'http.js' },
    };
    const result = run(
      {
        'common.js': `import '@nf-internal/chunk-C';`,
        'http.js': `import '@nf-internal/chunk-H'; import './common.js';`,
        'chunk-C.js': '',
        'chunk-H.js': '',
      },
      { shared: [dense] }
    );
    expect(result.shared[0]).toMatchObject({ chunks: ['chunk-C.js', 'chunk-H.js'] });
  });

  // Only a preload record's chunks are read by the runtime; this covers chunk records and
  // shared mappings too, which never carry preload.
  it('leaves a shared record without preload untouched', () => {
    const external = shared('@angular/core', 'core.js');
    const result = run(
      { 'core.js': `import '@nf-internal/chunk-C';`, 'chunk-C.js': '' },
      { shared: [external] }
    );
    expect(result.shared[0]).toBe(external);
  });

  // Cached externals outlive a build; writing into them would leak one build's chunks into the next.
  it('does not mutate its input', () => {
    const external = shared('@angular/core', 'core.js', { preload: true });
    const expose = exposed('./Home', 'home.js');
    run(
      {
        'core.js': `import './chunk-C.js';`,
        'home.js': `import './chunk-C.js';`,
        'chunk-C.js': '',
      },
      { shared: [external], exposes: [expose] }
    );
    expect(external).not.toHaveProperty('chunks');
    expect(expose).not.toHaveProperty('chunks');
  });
});
