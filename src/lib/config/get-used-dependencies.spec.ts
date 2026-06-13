import { describe, expect, it } from 'vitest';
import type { ProjectData } from '@softarc/sheriff-core';
import {
  getUsedDependenciesFactoryCore,
  isSharedMapping,
  matchMapping,
  type UsedDependenciesDeps,
} from './get-used-dependencies.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';

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

    const used = getUsedDependenciesFactoryCore(deps, '/ws')({
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

    const used = getUsedDependenciesFactoryCore(deps, '/ws')({
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

    const used = getUsedDependenciesFactoryCore(deps, '/ws')({
      exposes: { './Comp': { file: 'src/comp.ts' } },
      sharedMappings: { '/ws/libs/ui/*': '@org/ui/*' },
    });

    expect(used.internal).toEqual({ '/ws/libs/ui/button.ts': '@org/ui/button' });
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
