import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '@softarc/sheriff-core';
import {
  getUsedDependenciesFactoryCore,
  type UsedDependenciesDeps,
} from './get-used-dependencies.js';
import { isSharedMapping, matchMapping } from './match-mapping.js';
import { createMemoryIo, type MemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';
import { logger } from '../utils/logger.js';
import * as path from 'path';

describe('getUsedDependenciesFactoryCore', () => {
  // Build deps backed by memory-io: `projectData` is the canned sheriff output
  // and `node_modules` holds package.json + entry files so transient peer
  // discovery (getPackageInfo + getExternalImports) runs fs-free. Every analyzed file also
  // exists under `root`, because entry points are resolved on disk before sheriff runs.
  function makeDeps(
    projectData: ProjectData,
    files: Record<string, string> = {},
    root = '/ws'
  ): UsedDependenciesDeps {
    const io = createMemoryIo();
    io.setFile('/ws/package.json', JSON.stringify({ name: 'app' }));
    for (const p of Object.keys(projectData)) io.setFile(path.resolve(root, p), '');
    for (const [p, content] of Object.entries(files)) io.setFile(p, content);
    return {
      io,
      repo: createPackageJsonRepository(io),
      getProjectData: () => projectData,
    };
  }

  it('collects external libraries and unresolved imports as used dependencies', () => {
    const deps = makeDeps({
      'src/comp.ts': {
        imports: [],
        externalLibraries: ['rxjs'],
        unresolvedImports: ['@angular/core'],
      },
    } as unknown as ProjectData);

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
    });

    expect(used.external).toContain('rxjs');
    expect(used.external).toContain('@angular/core');
  });

  it('discovers transient peer deps through the injected repo + io', () => {
    const deps = makeDeps(
      {
        'src/comp.ts': { imports: [], externalLibraries: ['pkg-a'], unresolvedImports: [] },
      } as unknown as ProjectData,
      {
        '/ws/node_modules/pkg-a/package.json': JSON.stringify({
          name: 'pkg-a',
          version: '1.0.0',
          main: 'index.js',
        }),
        '/ws/node_modules/pkg-a/index.js': "import 'pkg-b';",
      }
    );

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
    });

    expect(used.external).toContain('pkg-a');
    expect(used.external).toContain('pkg-b');
  });

  // Each shared package is scanned through the exports condition of its own platform; a
  // package that is not shared, such as a transitive dependency, through the config's platform,
  // browser when the config sets none.
  it.each([
    [
      'a node package',
      { pkg: { platform: 'node' as const } },
      undefined,
      'node-only',
      'browser-only',
    ],
    [
      'a browser package',
      { pkg: { platform: 'browser' as const } },
      'node' as const,
      'browser-only',
      'node-only',
    ],
    ['a package that is not shared', {}, undefined, 'browser-only', 'node-only'],
  ])('scans %s through its own exports condition', (_, shared, platform, kept, missed) => {
    const deps = makeDeps(
      {
        'src/comp.ts': { imports: [], externalLibraries: ['pkg'], unresolvedImports: [] },
      } as unknown as ProjectData,
      {
        '/ws/node_modules/pkg/package.json': JSON.stringify({
          name: 'pkg',
          version: '1.0.0',
          exports: { '.': { node: './server.js', browser: './client.js' } },
        }),
        '/ws/node_modules/pkg/server.js': "import 'node-only';",
        '/ws/node_modules/pkg/client.js': "import 'browser-only';",
      }
    );

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
      shared,
      ...(platform && { platform }),
    });

    expect(used.external).toContain(kept);
    expect(used.external).not.toContain(missed);
  });

  it("scans a transitive dependency that is not shared through a node config's node condition", () => {
    const deps = makeDeps(
      {
        'src/comp.ts': { imports: [], externalLibraries: ['srv'], unresolvedImports: [] },
      } as unknown as ProjectData,
      {
        '/ws/node_modules/srv/package.json': JSON.stringify({
          name: 'srv',
          version: '1.0.0',
          exports: './index.js',
        }),
        '/ws/node_modules/srv/index.js': "import 'pkg';",
        '/ws/node_modules/pkg/package.json': JSON.stringify({
          name: 'pkg',
          version: '1.0.0',
          exports: { '.': { node: './server.js', browser: './client.js' } },
        }),
        '/ws/node_modules/pkg/server.js': "import 'node-only';",
        '/ws/node_modules/pkg/client.js': "import 'browser-only';",
      }
    );

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
      shared: { srv: { platform: 'node' } },
      platform: 'node',
    });

    expect(used.external).toContain('node-only');
    expect(used.external).not.toContain('browser-only');
  });

  // Only a key of `shared` takes the shared platform: a secondary that is not one is read with
  // the config's platform.
  it('scans a secondary that is not a key of shared through the config platform', () => {
    const deps = makeDeps(
      {
        'src/comp.ts': { imports: [], externalLibraries: ['pkg/sub'], unresolvedImports: [] },
      } as unknown as ProjectData,
      {
        '/ws/node_modules/pkg/package.json': JSON.stringify({
          name: 'pkg',
          version: '1.0.0',
          exports: { './sub': { node: './server.js', browser: './client.js' } },
        }),
        '/ws/node_modules/pkg/server.js': "import 'node-only';",
        '/ws/node_modules/pkg/client.js': "import 'browser-only';",
      }
    );

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
      shared: { pkg: { platform: 'node' } },
    });

    expect(used.external).toContain('browser-only');
    expect(used.external).not.toContain('node-only');
  });

  it('skips a package whose exports blocks the entry point, without a warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps(
      {
        'src/comp.ts': { imports: [], externalLibraries: ['pkg/internal'], unresolvedImports: [] },
      } as unknown as ProjectData,
      {
        '/ws/node_modules/pkg/package.json': JSON.stringify({
          name: 'pkg',
          version: '1.0.0',
          exports: { '.': './index.js', './internal': null },
        }),
        '/ws/node_modules/pkg/internal/package.json': '{"main":"./index.js"}',
        '/ws/node_modules/pkg/internal/index.js': "import 'leaked';",
      }
    );

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
      shared: {},
    });

    expect(used.external).toContain('pkg/internal');
    expect(used.external).not.toContain('leaked');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // Packages reached through another package's entry closure. Each row builds its own io and
  // repository: the repository caches lookups, so a shared one would leak layouts between rows.
  describe('transitive packages', () => {
    // Two install layouts: hoisted (everything flat under the root node_modules) and isolated
    // (real dirs under node_modules/.pnpm, symlinked into the node_modules of whoever declares
    // them).
    function setPackage(io: MemoryIo, dir: string, imports: string[], version = '1.0.0'): void {
      io.setFile(
        `${dir}/package.json`,
        JSON.stringify({ name: path.basename(dir), version, main: 'index.js' })
      );
      io.setFile(`${dir}/index.js`, imports.map(i => `import '${i}';`).join('\n'));
    }

    const store = (name: string, version = '1.0.0') =>
      `/ws/node_modules/.pnpm/${name}@${version}/node_modules/${name}`;

    // Isolated install: `owner` sees `name` only through its own node_modules link.
    function link(io: MemoryIo, ownerNodeModules: string, name: string, version = '1.0.0'): void {
      io.setSymlink(`${ownerNodeModules}/${name}`, store(name, version));
    }

    // node_modules folder that sits next to a package inside the store, as the isolated layout
    // puts each package's own dependencies.
    const storeDeps = (name: string, version = '1.0.0') =>
      `/ws/node_modules/.pnpm/${name}@${version}/node_modules`;

    // The app's code imports `a` only.
    function scan(io: MemoryIo, shared: string[] = []): string[] {
      io.setFile('/ws/package.json', JSON.stringify({ name: 'app' }));
      io.setFile('/ws/src/main.ts', '');
      const projectData = {
        'src/main.ts': { imports: [], externalLibraries: ['a'], unresolvedImports: [] },
      } as unknown as ProjectData;
      const deps: UsedDependenciesDeps = {
        io,
        repo: createPackageJsonRepository(io),
        getProjectData: () => projectData,
      };
      const used = getUsedDependenciesFactoryCore(deps, '/ws', ['src/main.ts'])({
        sharedMappings: {},
        shared: Object.fromEntries(shared.map(name => [name, { platform: 'browser' as const }])),
      });
      return [...used.external].sort();
    }

    it('reports what a dependency of a dependency imports (hoisted)', () => {
      const io = createMemoryIo();
      setPackage(io, '/ws/node_modules/a', ['b']);
      setPackage(io, '/ws/node_modules/b', ['c']);
      setPackage(io, '/ws/node_modules/c', ['d']);

      expect(scan(io)).toEqual(['a', 'b', 'c', 'd']);
    });

    // The app declares `a` and `c`; `b` is only `a`'s dependency, so it is not reachable from
    // the workspace root.
    it('reports what a dependency of a dependency imports (isolated)', () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['b']);
      setPackage(io, store('b'), ['c']);
      setPackage(io, store('c'), ['d']);
      setPackage(io, store('d'), []);
      link(io, '/ws/node_modules', 'a');
      link(io, '/ws/node_modules', 'c');
      link(io, storeDeps('a'), 'b');
      link(io, storeDeps('b'), 'c');
      link(io, storeDeps('c'), 'd');

      expect(scan(io)).toEqual(['a', 'b', 'c', 'd']);
    });

    // `a` and `b` each depend on their own install of `c`, and the two versions import different
    // packages.
    it('scans each install of a package that is installed twice', () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['b', 'c']);
      setPackage(io, store('b'), ['c']);
      setPackage(io, store('c', '1.0.0'), ['x'], '1.0.0');
      setPackage(io, store('c', '2.0.0'), ['y'], '2.0.0');
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'b');
      link(io, storeDeps('a'), 'c', '1.0.0');
      link(io, storeDeps('b'), 'c', '2.0.0');

      expect(scan(io)).toEqual(['a', 'b', 'c', 'x', 'y']);
    });

    // `a` and `b` each link the same install of `c`: two paths, one real file, one scan.
    it('scans an install reached through two symlinks once', () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['b', 'c']);
      setPackage(io, store('b'), ['c']);
      setPackage(io, store('c'), ['x']);
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'b');
      link(io, storeDeps('a'), 'c');
      link(io, storeDeps('b'), 'c');
      const readText = vi.spyOn(io, 'readText');

      expect(scan(io)).toEqual(['a', 'b', 'c', 'x']);
      const reads = readText.mock.calls.filter(([file]) => file.endsWith('/c/index.js'));
      expect(reads).toHaveLength(1);
    });

    // A linked checkout outside the workspace has no node_modules path back to the root, so the
    // phantom dependency it imports is found only by looking from the workspace root.
    it('scans a phantom dependency of a linked package from the workspace root', () => {
      const io = createMemoryIo();
      setPackage(io, '/dev/a', ['p']);
      io.setSymlink('/ws/node_modules/a', '/dev/a');
      setPackage(io, '/ws/node_modules/p', ['q']);

      expect(scan(io)).toEqual(['a', 'p', 'q']);
    });

    // The root has its own hoisted `c`, and `a` has its own `c` installed next to it. A shared `c`
    // is bundled once from the workspace root, so the root's copy is what `a` loads at runtime.
    it("scans the workspace root's install of a shared package, not the importer's", () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['c']);
      setPackage(io, '/ws/node_modules/c', ['x'], '1.0.0');
      setPackage(io, store('c', '2.0.0'), ['y'], '2.0.0');
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'c', '2.0.0');

      expect(scan(io, ['c'])).toEqual(['a', 'c', 'x']);
    });

    // Same layout, but `c` is not shared: it is bundled into `a`'s importer, from `a`'s own install.
    it("scans the importer's own install of a package that is not shared", () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['c']);
      setPackage(io, '/ws/node_modules/c', ['x'], '1.0.0');
      setPackage(io, store('c', '2.0.0'), ['y'], '2.0.0');
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'c', '2.0.0');

      expect(scan(io)).toEqual(['a', 'c', 'y']);
    });

    // `a`'s own `c` blocks its root entry, but a shared `c` is never looked up from `a`.
    it("scans the workspace root's install of a shared package the importer's install does not export", () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['c']);
      setPackage(io, '/ws/node_modules/c', ['x'], '1.0.0');
      setPackage(io, store('c', '2.0.0'), ['y'], '2.0.0');
      io.setFile(
        `${store('c', '2.0.0')}/package.json`,
        JSON.stringify({ name: 'c', version: '2.0.0', exports: { '.': null } })
      );
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'c', '2.0.0');

      expect(scan(io, ['c'])).toEqual(['a', 'c', 'x']);
    });

    // `c` is not shared and `a`'s own `c` blocks its root entry; the root's `c` is not what `a`
    // imports, so it is not scanned in its place.
    it("does not fall back to the workspace root when the importer's install is not exported", () => {
      const io = createMemoryIo();
      setPackage(io, store('a'), ['c']);
      setPackage(io, '/ws/node_modules/c', ['x'], '1.0.0');
      setPackage(io, store('c', '2.0.0'), ['y'], '2.0.0');
      io.setFile(
        `${store('c', '2.0.0')}/package.json`,
        JSON.stringify({ name: 'c', version: '2.0.0', exports: { '.': null } })
      );
      link(io, '/ws/node_modules', 'a');
      link(io, storeDeps('a'), 'c', '2.0.0');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      expect(scan(io)).toEqual(['a', 'c']);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it('resolves internal shared mappings from analyzed imports', () => {
    const deps = makeDeps({
      'src/comp.ts': {
        imports: ['libs/ui/button.ts'],
        externalLibraries: [],
        unresolvedImports: [],
      },
    } as unknown as ProjectData);

    const used = getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: { '/ws/libs/ui/*': '@org/ui/*' },
    });

    expect(used.internal).toEqual({ '/ws/libs/ui/button.ts': '@org/ui/button' });
  });

  // core#135: a mapping reachable only through another mapping's barrel was pruned, while the
  // surviving barrel chunk still imported it, so the app failed to resolve the specifier.
  describe('mapping-to-mapping references', () => {
    const sharedMappings = { '/ws/libs/internal/src/*': '@internal/*' };

    // The issue's fixture: the host imports @internal/kit, whose barrel republishes
    // @internal/kit/sub through its own alias. Nothing in app code names the sub entry point.
    // `kitRawImports` is sheriff's `rawImports` for the kit barrel: resolved file -> specifiers.
    function kitFixture(kitRawImports: Record<string, string[]>, kitExternals: string[] = []) {
      return makeDeps({
        'src/main.ts': {
          imports: ['libs/internal/src/kit/index.ts'],
          rawImports: { 'libs/internal/src/kit/index.ts': ['@internal/kit'] },
          externalLibraries: [],
          unresolvedImports: [],
        },
        'libs/internal/src/kit/index.ts': {
          imports: Object.keys(kitRawImports),
          rawImports: kitRawImports,
          externalLibraries: kitExternals,
          unresolvedImports: [],
        },
        'libs/internal/src/kit/kit.module.ts': {
          imports: [],
          externalLibraries: [],
          unresolvedImports: [],
        },
        'libs/internal/src/kit/sub/index.ts': {
          imports: ['libs/internal/src/kit/sub/widget.component.ts'],
          rawImports: { 'libs/internal/src/kit/sub/widget.component.ts': ['./widget.component'] },
          externalLibraries: [],
          unresolvedImports: [],
        },
        'libs/internal/src/kit/sub/widget.component.ts': {
          imports: [],
          externalLibraries: [],
          unresolvedImports: [],
        },
      } as unknown as ProjectData);
    }

    const run = (deps: UsedDependenciesDeps) =>
      getUsedDependenciesFactoryCore(deps, '/ws', ['src/main.ts'])({ sharedMappings });

    it('keeps a mapping that only another mapping imports by specifier', () => {
      const used = run(
        kitFixture({
          'libs/internal/src/kit/kit.module.ts': ['./kit.module'],
          'libs/internal/src/kit/sub/index.ts': ['@internal/kit/sub'],
        })
      );

      expect(used.internal).toEqual({
        '/ws/libs/internal/src/kit/index.ts': '@internal/kit',
        '/ws/libs/internal/src/kit/sub/index.ts': '@internal/kit/sub',
      });
    });

    // sheriff lists every spelling a file was imported with; one by specifier is enough.
    it('keeps a mapping imported both relatively and by specifier', () => {
      const used = run(
        kitFixture({ 'libs/internal/src/kit/sub/index.ts': ['./sub', '@internal/kit/sub'] })
      );

      expect(used.internal['/ws/libs/internal/src/kit/sub/index.ts']).toBe('@internal/kit/sub');
    });

    // Relative imports are the lib's own implementation and are bundled into it. Counting them
    // would publish every internal file of a wildcard lib, including non-barrel specifiers such
    // as '@internal/kit/kit.module' that assertBarrelMappings rejects.
    it('does not publish files a mapping reaches through relative imports', () => {
      const used = run(
        kitFixture({
          'libs/internal/src/kit/kit.module.ts': ['./kit.module'],
          'libs/internal/src/kit/sub/index.ts': ['./sub'],
        })
      );

      expect(used.internal).toEqual({ '/ws/libs/internal/src/kit/index.ts': '@internal/kit' });
    });

    // A deep import through the alias names a file, not an entry point: publishing it would make
    // assertBarrelMappings fail the build. It is still reported, so removeUnusedDeps can warn once
    // it knows which mappings are published.
    it('does not publish a non-barrel specifier a mapping imports, but reports it', () => {
      const used = run(
        kitFixture({
          'libs/internal/src/kit/sub/widget.component.ts': ['@internal/kit/sub/widget.component'],
        })
      );

      expect(used.internal).toEqual({ '/ws/libs/internal/src/kit/index.ts': '@internal/kit' });
      expect(used.mappingImports).toEqual(
        new Map([['@internal/kit/sub/widget.component', 'libs/internal/src/kit/index.ts']])
      );
    });

    it('reports external and unresolved specifiers a mapping imports', () => {
      const used = run(kitFixture({}, ['rxjs']));

      expect(used.mappingImports).toEqual(new Map([['rxjs', 'libs/internal/src/kit/index.ts']]));
    });

    // sheriff's default ignoreFileExtensions drop '*.json' before it records anything, so this
    // specifier reaches neither rawImports nor externalLibraries; only the source has it.
    it('reports a specifier sheriff skips for its file extension', () => {
      const deps = makeDeps(
        {
          'src/main.ts': {
            imports: ['libs/internal/src/kit/index.ts'],
            rawImports: { 'libs/internal/src/kit/index.ts': ['@internal/kit'] },
            externalLibraries: [],
            unresolvedImports: [],
          },
          'libs/internal/src/kit/index.ts': {
            imports: [],
            rawImports: {},
            externalLibraries: [],
            unresolvedImports: [],
          },
        } as unknown as ProjectData,
        {
          '/ws/libs/internal/src/kit/index.ts':
            "import config from '@internal/kit/sub/config.json';\nexport { config };\n",
        }
      );

      expect(run(deps).mappingImports).toEqual(
        new Map([['@internal/kit/sub/config.json', 'libs/internal/src/kit/index.ts']])
      );
    });

    it('does not report imports from outside a mapping', () => {
      const used = run(kitFixture({ 'libs/internal/src/kit/kit.module.ts': ['./kit.module'] }));

      expect(used.mappingImports).toEqual(new Map());
    });

    // Decided per import, not per file: the barrel naming '@org/ui' must not also publish a
    // nested index it reaches relatively, which an exact mapping matches under the same name.
    it('does not publish a relatively imported file under a specifier the file uses elsewhere', () => {
      const deps = makeDeps({
        'src/main.ts': {
          imports: ['libs/feature/index.ts'],
          rawImports: { 'libs/feature/index.ts': ['@org/feature'] },
          externalLibraries: [],
          unresolvedImports: [],
        },
        'libs/feature/index.ts': {
          imports: ['libs/ui/index.ts', 'libs/ui/deep/index.ts'],
          rawImports: {
            'libs/ui/index.ts': ['@org/ui'],
            'libs/ui/deep/index.ts': ['../ui/deep'],
          },
          externalLibraries: [],
          unresolvedImports: [],
        },
      } as unknown as ProjectData);

      const used = getUsedDependenciesFactoryCore(deps, '/ws', ['src/main.ts'])({
        sharedMappings: { '/ws/libs/feature': '@org/feature', '/ws/libs/ui': '@org/ui' },
      });

      expect(used.internal).toEqual({
        '/ws/libs/feature/index.ts': '@org/feature',
        '/ws/libs/ui/index.ts': '@org/ui',
      });
    });
  });

  // The reported failure mode: mapping keys spelled 'C:/ws/…' (from cwd) against imports built
  // on 'c:/ws' (from Nx). Every affected library is pruned and silently missing from
  // remoteEntry.json, so the walk reports what the pruned set alone cannot distinguish.
  describe('case-only mapping misses', () => {
    const caseOnly = /match a shared mapping only when case is ignored/;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function runWith(
      sharedMappings: Record<string, string>,
      workspaceRoot = 'c:/ws',
      imports = ['libs/ui/button.ts']
    ) {
      const deps = makeDeps(
        {
          'src/comp.ts': {
            imports,
            externalLibraries: [],
            unresolvedImports: [],
          },
        } as unknown as ProjectData,
        {},
        workspaceRoot
      );

      return getUsedDependenciesFactoryCore(
        deps,
        workspaceRoot
      )({
        exposes: { './Comp': { file: 'src/comp.ts' } },
        sharedMappings,
      });
    }

    it('warns and prunes when the mapping key differs from the import by case alone', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const used = runWith({ 'C:/ws/libs/ui/*': '@org/ui/*' });

      expect(used.internal).toEqual({});
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(caseOnly));
    });

    // A partial list sends the reader hunting for the rest, so every affected import is named.
    it('names every affected import so the mismatch is visible', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      runWith({ 'C:/ws/libs/ui/*': '@org/ui/*' }, 'c:/ws', [
        'libs/ui/button.ts',
        'libs/ui/card.ts',
      ]);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain(path.join('c:/ws', 'libs/ui/button.ts'));
      expect(warn.mock.calls[0]?.[0]).toContain(path.join('c:/ws', 'libs/ui/card.ts'));
    });

    it('stays silent when the import genuinely reaches no mapping', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const used = runWith({ 'c:/ws/libs/unrelated/*': '@org/unrelated/*' });

      expect(used.internal).toEqual({});
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(caseOnly));
    });

    it('stays silent when the mapping matches on the nose', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const used = runWith({ [path.join('c:/ws', 'libs/ui') + '/*']: '@org/ui/*' });

      expect(Object.keys(used.internal)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(caseOnly));
    });
  });

  it('falls back to the provided entry points when no exposes are present', () => {
    const deps = makeDeps({
      'src/main.ts': { imports: [], externalLibraries: ['rxjs'], unresolvedImports: [] },
    } as unknown as ProjectData);

    const used = getUsedDependenciesFactoryCore(deps, '/ws', ['src/main.ts'])({
      sharedMappings: {},
    });

    expect(used.external).toContain('rxjs');
  });

  // Sheriff's results are relative to the root it is given, and resolveUsedMappings re-joins them
  // onto workspaceRoot, so a cwd root resolved mappings against the wrong folder whenever the
  // build ran from elsewhere.
  it('roots the sheriff scan at workspaceRoot, not cwd', () => {
    const deps = makeDeps({} as ProjectData, { '/ws/src/comp.ts': '' });
    const getProjectData = vi.fn(() => ({}) as ProjectData);
    deps.getProjectData = getProjectData;

    getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: {},
    });

    expect(getProjectData).toHaveBeenCalledWith('src/comp.ts', '/ws', expect.anything());
  });

  // Sheriff joins the entry onto its root unconditionally, so '/ws/src/comp.ts' would become
  // '/ws/ws/src/comp.ts'.
  it('hands sheriff an absolute entry point relative to workspaceRoot', () => {
    const deps = makeDeps({} as ProjectData, { '/ws/src/comp.ts': '' });
    const getProjectData = vi.fn(() => ({}) as ProjectData);
    deps.getProjectData = getProjectData;

    getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file: '/ws/src/comp.ts' } },
      sharedMappings: {},
    });

    expect(getProjectData).toHaveBeenCalledWith(
      path.join('src', 'comp.ts'),
      '/ws',
      expect.anything()
    );
  });

  // Sheriff needs an existing file; the bundler also accepts these spellings, so they were
  // valid exposes that crashed the analysis with sheriff's FsPath/EISDIR error.
  it.each([
    ['an extensionless expose', 'src/main', path.join('src', 'main.ts')],
    ['a folder expose', 'src/widget', path.join('src', 'widget', 'index.ts')],
  ])('hands sheriff the file %s resolves to', (_, file, expected) => {
    const deps = makeDeps({} as ProjectData, {
      '/ws/src/main.ts': '',
      '/ws/src/widget/index.ts': '',
    });
    const getProjectData = vi.fn(() => ({}) as ProjectData);
    deps.getProjectData = getProjectData;

    getUsedDependenciesFactoryCore(
      deps,
      '/ws'
    )({
      exposes: { './Comp': { file } },
      sharedMappings: {},
    });

    expect(getProjectData).toHaveBeenCalledWith(expected, '/ws', expect.anything());
  });

  it('names the expose file when nothing exists at it', () => {
    const deps = makeDeps({} as ProjectData);

    expect(() =>
      getUsedDependenciesFactoryCore(
        deps,
        '/ws'
      )({
        exposes: { './Comp': { file: 'src/missing' } },
        sharedMappings: {},
      })
    ).toThrow(/Entry point 'src\/missing' does not exist/);
  });

  it('throws when neither exposes nor fallback entry points are available', () => {
    const deps = makeDeps({} as ProjectData);
    expect(() => getUsedDependenciesFactoryCore(deps, '/ws')({ sharedMappings: {} })).toThrow(
      /missing an entryPoint/
    );
  });
});

describe('isSharedMapping', () => {
  it('matches a wildcard mapping by prefix', () => {
    expect(isSharedMapping('/ws/libs/ui/button.ts', { '/ws/libs/ui/*': '@org/ui/*' })).toBe(true);
    expect(isSharedMapping('/ws/libs/data/x.ts', { '/ws/libs/ui/*': '@org/ui/*' })).toBe(false);
  });

  it('matches an exact (non-wildcard) mapping or a file under it', () => {
    const mapping = { '/ws/libs/ui': '@org/ui' };
    expect(isSharedMapping('/ws/libs/ui', mapping)).toBe(true);
    expect(isSharedMapping('/ws/libs/ui/button.ts', mapping)).toBe(true);
    expect(isSharedMapping('/ws/libs/uikit', mapping)).toBe(false);
  });
});

describe('matchMapping', () => {
  it('captures the wildcard segment and strips the extension', () => {
    expect(matchMapping('/ws/libs/ui/button.ts', { '/ws/libs/ui/*': '@org/ui/*' })).toBe(
      '@org/ui/button'
    );
  });

  it('captures using the first suffix occurrence after the prefix', () => {
    expect(matchMapping('/ws/libs/ui/index.ts', { '/ws/libs/*/index.ts': '@org/*' })).toBe(
      '@org/ui'
    );
  });

  it('resolves a barrel (index) file to its directory mapping', () => {
    expect(matchMapping('/ws/libs/ui/index.ts', { '/ws/libs/ui': '@org/ui' })).toBe('@org/ui');
  });

  it('returns null when nothing matches', () => {
    expect(matchMapping('/ws/other/x.ts', { '/ws/libs/ui/*': '@org/ui/*' })).toBeNull();
  });
});
