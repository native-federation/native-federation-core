import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '@softarc/sheriff-core';
import {
  getUsedDependenciesFactoryCore,
  type UsedDependenciesDeps,
} from './get-used-dependencies.js';
import { isSharedMapping, matchMapping } from './match-mapping.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';
import { logger } from '../utils/logger.js';
import * as path from 'path';

describe('getUsedDependenciesFactoryCore', () => {
  // Build deps backed by memory-io: `projectData` is the canned sheriff output
  // and `node_modules` holds package.json + entry files so transient peer
  // discovery (getPackageInfo + getExternalImports) runs fs-free.
  function makeDeps(
    projectData: ProjectData,
    files: Record<string, string> = {}
  ): UsedDependenciesDeps {
    const io = createMemoryIo();
    io.setFile('/ws/package.json', JSON.stringify({ name: 'app' }));
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
    function kitFixture(
      kitBarrel: string,
      kitImports = ['libs/internal/src/kit/kit.module.ts', 'libs/internal/src/kit/sub/index.ts']
    ) {
      return makeDeps(
        {
          'src/main.ts': {
            imports: ['libs/internal/src/kit/index.ts'],
            externalLibraries: [],
            unresolvedImports: [],
          },
          'libs/internal/src/kit/index.ts': {
            imports: kitImports,
            externalLibraries: [],
            unresolvedImports: [],
          },
          'libs/internal/src/kit/kit.module.ts': {
            imports: [],
            externalLibraries: [],
            unresolvedImports: [],
          },
          'libs/internal/src/kit/sub/index.ts': {
            imports: ['libs/internal/src/kit/sub/widget.component.ts'],
            externalLibraries: [],
            unresolvedImports: [],
          },
          'libs/internal/src/kit/sub/widget.component.ts': {
            imports: [],
            externalLibraries: [],
            unresolvedImports: [],
          },
        } as unknown as ProjectData,
        {
          '/ws/libs/internal/src/kit/index.ts': kitBarrel,
          '/ws/libs/internal/src/kit/sub/index.ts': "export * from './widget.component';",
        }
      );
    }

    const run = (deps: UsedDependenciesDeps) =>
      getUsedDependenciesFactoryCore(deps, '/ws', ['src/main.ts'])({ sharedMappings });

    it('keeps a mapping that only another mapping imports by specifier', () => {
      const used = run(
        kitFixture("export * from './kit.module';\nexport * from '@internal/kit/sub';")
      );

      expect(used.internal).toEqual({
        '/ws/libs/internal/src/kit/index.ts': '@internal/kit',
        '/ws/libs/internal/src/kit/sub/index.ts': '@internal/kit/sub',
      });
    });

    it('counts a dynamic import by specifier too', () => {
      const used = run(kitFixture("export const load = () => import('@internal/kit/sub');"));

      expect(used.internal['/ws/libs/internal/src/kit/sub/index.ts']).toBe('@internal/kit/sub');
    });

    // Relative imports are the lib's own implementation and are bundled into it. Counting them
    // would publish every internal file of a wildcard lib, including non-barrel specifiers such
    // as '@internal/kit/kit.module' that assertBarrelMappings rejects.
    it('does not publish files a mapping reaches through relative imports', () => {
      const used = run(kitFixture("export * from './kit.module';\nexport * from './sub';"));

      expect(used.internal).toEqual({ '/ws/libs/internal/src/kit/index.ts': '@internal/kit' });
    });

    // A deep import through the alias names a file, not an entry point: publishing it would make
    // assertBarrelMappings fail the build. It is still reported, so removeUnusedDeps can warn once
    // it knows which mappings are published.
    it('does not publish a non-barrel specifier a mapping imports, but reports it', () => {
      const used = run(
        kitFixture("export * from '@internal/kit/sub/widget.component';", [
          'libs/internal/src/kit/sub/widget.component.ts',
        ])
      );

      expect(used.internal).toEqual({ '/ws/libs/internal/src/kit/index.ts': '@internal/kit' });
      expect(used.mappingImports).toEqual(
        new Map([['@internal/kit/sub/widget.component', 'libs/internal/src/kit/index.ts']])
      );
    });

    it('does not report imports from outside a mapping', () => {
      const used = run(kitFixture("export * from './kit.module';"));

      expect(used.mappingImports).toEqual(new Map());
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
      const deps = makeDeps({
        'src/comp.ts': {
          imports,
          externalLibraries: [],
          unresolvedImports: [],
        },
      } as unknown as ProjectData);

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
