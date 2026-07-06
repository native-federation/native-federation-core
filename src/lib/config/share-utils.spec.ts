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

  it('patches a shared external in place', () => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      { projectPath: PROJECT, patchList: { mylib: { singleton: false, strictVersion: true } } },
      repo
    );

    expect(result!['mylib']).toMatchObject({
      singleton: false,
      strictVersion: true,
      requiredVersion: '^1.2.3',
    });
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
      { projectPath: PROJECT, patchList: { doesnotexist: { singleton: false } } },
      repo
    );

    expect(Object.keys(result!)).toEqual(['mylib']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a shared external'));
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
        patchList: { overridden: { singleton: true } },
      },
      repo
    );

    // The override value wins; the patch is not applied.
    expect(result!['overridden']).toMatchObject({ singleton: false, requiredVersion: '~3.1.0' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
    warn.mockRestore();
  });
});
