import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { shareAllCore, shareCore } from './share-utils.js';
import { DEFAULT_SKIP_LIST } from './default-skip-list.js';
import { logger } from '../utils/logger.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';

describe('shareCore (end-to-end via injected repository)', () => {
  const PROJECT = path.resolve('/ws/app');

  it('resolves a requiredVersion of "auto" from the in-memory dependency map', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: 'auto', includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib']).toMatchObject({
      singleton: true,
      requiredVersion: '^1.2.3',
      version: '1.2.3',
    });
  });

  it('discovers a secondary entry point through the injected repository', () => {
    const libPath = path.join(PROJECT, 'node_modules', 'mylib');
    const io = createMemoryIo()
      .setFile(path.join(PROJECT, 'package.json'), '{}')
      .setFile(
        path.join(libPath, 'package.json'),
        JSON.stringify({
          version: '1.2.3',
          type: 'module',
          exports: {
            '.': './index.js',
            './sub': { default: './sub/index.js' },
          },
        })
      );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: '^1.0.0' } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(Object.keys(result)).toEqual(['mylib', 'mylib/sub']);
  });

  it('keeps the primary share when the dependency folder cannot be found', () => {
    const io = createMemoryIo().setFile(path.join(PROJECT, 'package.json'), '{}');
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: '^1.0.0' } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(Object.keys(result)).toEqual(['mylib']);
  });

  it('applies caret range when requiredVersion is auto with range "^" and base is exact semver', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: '^' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib']).toMatchObject({
      singleton: true,
      requiredVersion: '^1.2.3',
      version: '1.2.3',
    });
  });

  it('applies tilde range when requested for exact semver', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: '~' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib']).toMatchObject({
      singleton: true,
      requiredVersion: '~1.2.3',
      version: '1.2.3',
    });
  });

  it('minor -> caret and patch -> tilde mapping', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const rMinor = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: 'minor' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    const rPatch = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: 'patch' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(rMinor['mylib'].requiredVersion).toBe('^1.2.3');
    expect(rPatch['mylib'].requiredVersion).toBe('~1.2.3');
  });

  it('overwrites existing simple prefix when range is provided', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    // range '~' should overwrite '^1.2.3' -> '~1.2.3'
    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: '~' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib'].requiredVersion).toBe('~1.2.3');
  });

  // Same regex as the mapping path: a dash inside the prerelease tag must not defeat it.
  it('applies the range over a prerelease with build metadata', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '1.0.0-beta.1+sha' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: '^' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib'].requiredVersion).toBe('^1.0.0-beta.1+sha');
  });

  it('does not change complex ranges when applying auto range', () => {
    const complex = '>=1.0.0 <2.0.0';
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: complex } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: { range: '^' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib'].requiredVersion).toBe(complex);
  });
});

describe('shareAllCore (end-to-end via injected repository)', () => {
  const PROJECT = path.resolve('/ws/app');

  it('builds shared externals from the dependency map, honouring skip list and overrides', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3', skipme: '^2.0.0', overridden: '^3.0.0' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        skipList: ['skipme'],
        overrides: {
          overridden: { singleton: false, requiredVersion: '~3.1.0', includeSecondaries: false },
        },
      },
      repo
    );

    expect(Object.keys(result!).sort()).toEqual(['mylib', 'overridden']);
    expect(result!['mylib']).toMatchObject({ singleton: true, requiredVersion: '^1.2.3' });
    expect(result!['overridden']).toMatchObject({ singleton: false, requiredVersion: '~3.1.0' });
  });

  it('narrows the package.json dependencies to those matching the filter', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({
        dependencies: { '@org/a': '^1.0.0', '@org/b': '^1.0.0', rxjs: '^7.0.0', other: '^1.0.0' },
      })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      { projectPath: PROJECT, filter: ['@org/*', 'rxjs'] },
      repo
    );

    expect(Object.keys(result!).sort()).toEqual(['@org/a', '@org/b', 'rxjs']);
  });

  // Overrides are explicit additions, so the filter does not apply to them.
  it('keeps overrides that the filter does not cover', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3', overridden: '^3.0.0' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        filter: ['mylib'],
        overrides: {
          overridden: { singleton: false, requiredVersion: '~3.1.0', includeSecondaries: false },
        },
      },
      repo
    );

    expect(Object.keys(result!).sort()).toEqual(['mylib', 'overridden']);
  });

  it('ignores a patch for an external the filter excluded and warns', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3', other: '^1.0.0' } })
    );
    const repo = createPackageJsonRepository(io);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        filter: ['mylib'],
        patches: [{ patterns: ['other'], cfg: { singleton: false } }],
      },
      repo
    );

    expect(Object.keys(result!)).toEqual(['mylib']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'other'"));
    warn.mockRestore();
  });

  it('patches a shared external in place', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        patches: [{ patterns: ['mylib'], cfg: { singleton: false, strictVersion: true } }],
      },
      repo
    );

    expect(result!['mylib']).toMatchObject({
      singleton: false,
      strictVersion: true,
      requiredVersion: '^1.2.3',
    });
  });

  it('patches every shared package a wildcard pattern matches', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({
        dependencies: { '@angular/core': '^20.0.0', '@angular/common': '^20.0.0', rxjs: '^7.8.0' },
      })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      { projectPath: PROJECT, patches: [{ patterns: ['@angular/*'], cfg: { pool: 'ng-core' } }] },
      repo
    );

    expect(result!['@angular/core']).toMatchObject({ pool: 'ng-core' });
    expect(result!['@angular/common']).toMatchObject({ pool: 'ng-core' });
    expect(result!['rxjs']!.pool).toBeUndefined();
  });

  it('merges overlapping patches in call order', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { '@angular/core': '^20.0.0', '@angular/common': '^20.0.0' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        patches: [
          { patterns: ['@angular/*'], cfg: { pool: 'ng-core', strictVersion: true } },
          { patterns: ['@angular/core'], cfg: { strictVersion: false } },
        ],
      },
      repo
    );

    // The narrower, later patch overrides one field and keeps the rest of the wildcard patch.
    expect(result!['@angular/core']).toMatchObject({ pool: 'ng-core', strictVersion: false });
    expect(result!['@angular/common']).toMatchObject({ pool: 'ng-core', strictVersion: true });
  });

  it('warns for a wildcard pattern that matches no shared package', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      { projectPath: PROJECT, patches: [{ patterns: ['@angular/*'], cfg: { pool: 'ng-core' } }] },
      repo
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'@angular/*'"));
    warn.mockRestore();
  });

  it('ignores a patch for an external that is not shared and warns', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        patches: [{ patterns: ['doesnotexist'], cfg: { singleton: false } }],
      },
      repo
    );

    expect(Object.keys(result!)).toEqual(['mylib']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matches no shared package'));
    warn.mockRestore();
  });

  it('ignores a patch for an external that is shadowed by overrides and warns', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { overridden: '^3.0.0' } })
    );
    const repo = createPackageJsonRepository(io);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: PROJECT,
        overrides: {
          overridden: { singleton: false, requiredVersion: '~3.1.0', includeSecondaries: false },
        },
        patches: [{ patterns: ['overridden'], cfg: { singleton: true } }],
      },
      repo
    );

    // The override value wins; the patch is not applied.
    expect(result!['overridden']).toMatchObject({ singleton: false, requiredVersion: '~3.1.0' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
    warn.mockRestore();
  });
});
