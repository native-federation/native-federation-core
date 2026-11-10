import { describe, expect, it } from 'vitest';
import * as path from 'path';
import type {
  ExposesInfo,
  FederationInfo,
  OutputFile,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import { addChunkClosuresCore, ownerChunks, readImportGraph } from './chunk-closures.js';

const OUT = path.resolve('/ws/dist');

const browser = (...fileNames: string[]): OutputFile[] =>
  fileNames.map(fileName => ({ fileName, platform: 'browser' }));

// A plain object stands in for the lexed graph: each value lists what a key imports statically, and
// after a `lazy:` prefix, through a literal import().
const graph = (edges: Record<string, string[]>) => (fileName: string) => {
  const deps = edges[fileName] ?? [];
  return {
    static: deps.filter(d => !d.startsWith('lazy:')),
    dynamic: deps.filter(d => d.startsWith('lazy:')).map(d => d.slice('lazy:'.length)),
  };
};

const initial = (file: string) => ({ file, initial: true as const });
const lazy = (file: string) => ({ file });

describe('ownerChunks', () => {
  it.each([
    ['no imports', {}, ['entry.js'], {}],
    [
      'a chain',
      { 'entry.js': ['a.js'], 'a.js': ['b.js'] },
      ['entry.js'],
      { '@nf-internal/a': initial('a.js'), '@nf-internal/b': initial('b.js') },
    ],
    [
      'a diamond, deduped',
      { 'entry.js': ['a.js', 'b.js'], 'a.js': ['c.js'], 'b.js': ['c.js'] },
      ['entry.js'],
      {
        '@nf-internal/a': initial('a.js'),
        '@nf-internal/b': initial('b.js'),
        '@nf-internal/c': initial('c.js'),
      },
    ],
    [
      'a cycle',
      { 'entry.js': ['a.js'], 'a.js': ['b.js'], 'b.js': ['a.js'] },
      ['entry.js'],
      { '@nf-internal/a': initial('a.js'), '@nf-internal/b': initial('b.js') },
    ],
    // The runtime fetches the roots themselves; listing them would preload them twice.
    [
      'a chunk importing its root',
      { 'entry.js': ['a.js'], 'a.js': ['entry.js'] },
      ['entry.js'],
      { '@nf-internal/a': initial('a.js') },
    ],
    [
      'several roots, each excluded',
      { 'x.js': ['y.js', 'c.js'], 'y.js': ['d.js'] },
      ['x.js', 'y.js'],
      { '@nf-internal/c': initial('c.js'), '@nf-internal/d': initial('d.js') },
    ],
    // A lazy route's chunk is listed, so the runtime can map it, but not preloaded.
    [
      'a lazy chunk',
      { 'entry.js': ['lazy:route.js'] },
      ['entry.js'],
      { '@nf-internal/route': lazy('route.js') },
    ],
    // What a lazy chunk imports statically is still only needed once the route loads.
    [
      'the static imports of a lazy chunk',
      { 'entry.js': ['lazy:route.js'], 'route.js': ['deep.js'] },
      ['entry.js'],
      { '@nf-internal/route': lazy('route.js'), '@nf-internal/deep': lazy('deep.js') },
    ],
    // One static path to a chunk is enough to need it up front.
    [
      'a chunk reached both lazily and statically',
      { 'entry.js': ['lazy:route.js', 'a.js'], 'route.js': ['a.js'], 'a.js': ['lazy:route.js'] },
      ['entry.js'],
      { '@nf-internal/a': initial('a.js'), '@nf-internal/route': lazy('route.js') },
    ],
    ['a root imported lazily', { 'entry.js': ['lazy:entry.js'] }, ['entry.js'], {}],
    // The key is the import name the built files use, extension dropped.
    [
      'an .mjs chunk',
      { 'entry.mjs': ['chunk-AB12.mjs'] },
      ['entry.mjs'],
      { '@nf-internal/chunk-AB12': initial('chunk-AB12.mjs') },
    ],
  ])('%s', (_name, edges, roots, expected) => {
    // Strict: a lazy row has no `initial` key at all, not `initial: undefined`.
    expect(ownerChunks(roots, graph(edges))).toStrictEqual(expected);
  });

  // toEqual ignores key order; this pins it, so remoteEntry.json only changes when the files do.
  it('orders rows by file name', () => {
    const rows = ownerChunks(['entry.js'], graph({ 'entry.js': ['z.js', 'lazy:m.js', 'a.js'] }));
    expect(Object.values(rows).map(r => r.file)).toEqual(['a.js', 'm.js', 'z.js']);
  });
});

describe('readImportGraph', () => {
  const importsOf = (files: Record<string, string>, listed = Object.keys(files)) => {
    const io = createMemoryIo();
    for (const [name, code] of Object.entries(files)) io.setFile(path.join(OUT, name), code);
    return readImportGraph(io, OUT, browser(...listed));
  };

  it('follows a dense chunk import back to its file', () => {
    const of = importsOf({
      'entry.js': `import '@nf-internal/chunk-AB12';`,
      'chunk-AB12.js': '',
    });
    expect(of('entry.js')).toEqual({ static: ['chunk-AB12.js'], dynamic: [] });
  });

  it('follows a relative chunk import', () => {
    const of = importsOf({
      'entry.js': `import { a } from './chunk-AB12.js';`,
      'chunk-AB12.js': 'export const a = 1;',
    });
    expect(of('entry.js')).toEqual({ static: ['chunk-AB12.js'], dynamic: [] });
  });

  // toChunkImport drops any script extension, so the reverse lookup must find an .mjs chunk too.
  it('follows imports to .mjs chunks', () => {
    const of = importsOf({
      'entry.mjs': `import '@nf-internal/chunk-AB12'; import './chunk-CD34.mjs';`,
      'chunk-AB12.mjs': '',
      'chunk-CD34.mjs': '',
    });
    expect(of('entry.mjs')).toEqual({
      static: ['chunk-AB12.mjs', 'chunk-CD34.mjs'],
      dynamic: [],
    });
  });

  it('separates literal dynamic imports, relative and dense', () => {
    const of = importsOf({
      'entry.js': `import './chunk-A.js'; const r = () => [import('./chunk-B.js'), import('@nf-internal/chunk-C')];`,
      'chunk-A.js': '',
      'chunk-B.js': '',
      'chunk-C.js': '',
    });
    expect(of('entry.js')).toEqual({
      static: ['chunk-A.js'],
      dynamic: ['chunk-B.js', 'chunk-C.js'],
    });
  });

  // esbuild splits only on literal import(), so no chunk is reachable through a computed one.
  it('skips non-literal dynamic imports and import.meta', () => {
    const of = importsOf({
      'entry.js': `const u = import.meta.url; const r = name => import(name);`,
    });
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  it('stops a dynamic import at a bare specifier', () => {
    const of = importsOf({ 'entry.js': `const r = () => import('@angular/router');` });
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  // The import map resolves bare specifiers, possibly to another build's file.
  it('stops at bare specifiers', () => {
    const of = importsOf({ 'entry.js': `import '@angular/core'; import 'rxjs';` });
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  it('ignores relative imports of files this build did not write', () => {
    const of = importsOf({ 'entry.js': `import './elsewhere.js'; import './styles.css';` });
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  it('ignores a file on disk that the output list does not name', () => {
    const of = importsOf({ 'entry.js': `import './stray.js';`, 'stray.js': '' }, ['entry.js']);
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  // validateBareImports reports an unparsable file; here it only ends the walk.
  it('treats an unparsable file as having no imports', () => {
    const of = importsOf({ 'entry.js': 'import {' });
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
  });

  it('treats a missing file as having no imports', () => {
    const of = importsOf({}, ['entry.js']);
    expect(of('entry.js')).toEqual({ static: [], dynamic: [] });
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
      {
        key: './Home',
        outFileName: 'home.js',
        chunks: {
          '@nf-internal/chunk-A': { file: 'chunk-A.js', initial: true },
          '@nf-internal/chunk-B': { file: 'chunk-B.js', initial: true },
        },
      },
      {
        key: './Cart',
        outFileName: 'cart.js',
        chunks: { '@nf-internal/chunk-B': { file: 'chunk-B.js', initial: true } },
      },
    ]);
  });

  it('lists lazy chunks without initial, next to initial ones', () => {
    const result = run(
      {
        'home.js': `import './chunk-A.js'; const r = () => import('./chunk-R.js');`,
        'chunk-A.js': '',
        'chunk-R.js': `import './chunk-D.js';`,
        'chunk-D.js': '',
      },
      { exposes: [exposed('./Home', 'home.js')] }
    );

    expect(result.exposes[0]!.chunks).toEqual({
      '@nf-internal/chunk-A': { file: 'chunk-A.js', initial: true },
      '@nf-internal/chunk-R': { file: 'chunk-R.js' },
      '@nf-internal/chunk-D': { file: 'chunk-D.js' },
    });
  });

  it('omits chunks when the module reaches none', () => {
    const result = run(
      { 'home.js': `import 'rxjs';` },
      { exposes: [exposed('./Home', 'home.js')] }
    );
    expect(result.exposes[0]).not.toHaveProperty('chunks');
  });

  // A preload package's chunks are its bundle's, which top-level `chunks` already lists.
  it('leaves every shared record untouched, preload ones included', () => {
    const external = shared('@angular/core', 'core.js', { preload: true });
    const plain = shared('rxjs', 'rx.js');
    const result = run(
      { 'core.js': `import './chunk-C.js';`, 'rx.js': '', 'chunk-C.js': '' },
      { shared: [external, plain] }
    );
    expect(result.shared[0]).toBe(external);
    expect(result.shared[1]).toBe(plain);
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
