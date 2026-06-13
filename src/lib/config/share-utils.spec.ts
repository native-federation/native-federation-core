import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { cwd } from 'process';
import { findRootTsConfigJsonCore, getSecondaries, shareAllCore, shareCore } from './share-utils.js';
import { DEFAULT_SKIP_LIST, prepareSkipList } from './default-skip-list.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';
import type { ExternalConfig } from '../domain/config/external-config.contract.js';

const ROOT = cwd();
const EMPTY_SKIP = prepareSkipList([]);
const shareObject: ExternalConfig = { singleton: true, requiredVersion: '^1.0.0' };

describe('findRootTsConfigJsonCore', () => {
  const withPackageJson = () => createMemoryIo().setFile(path.join(ROOT, 'package.json'), '{}');

  it('prefers tsconfig.base.json when both exist', () => {
    const io = withPackageJson()
      .setFile(path.join(ROOT, 'tsconfig.base.json'), '{}')
      .setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.base.json'));
  });

  it('falls back to tsconfig.json when no base config exists', () => {
    const io = withPackageJson().setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.json'));
  });

  it('throws when neither config is present', () => {
    expect(() => findRootTsConfigJsonCore(withPackageJson())).toThrow(/Neither a tsconfig/);
  });
});

describe('getSecondaries', () => {
  const LIB = path.resolve('/root/node_modules/mylib');

  it('returns an empty map when the lib path does not exist', () => {
    expect(getSecondaries(createMemoryIo(), true, LIB, 'mylib', shareObject, EMPTY_SKIP)).toEqual(
      {}
    );
  });

  it('reads configured secondaries from the package.json exports map', () => {
    const io = createMemoryIo().setFile(
      path.join(LIB, 'package.json'),
      JSON.stringify({
        version: '1.2.3',
        type: 'module',
        exports: {
          '.': './index.js',
          './sub': { default: './sub/index.js' },
        },
      })
    );

    const result = getSecondaries(io, true, LIB, 'mylib', shareObject, EMPTY_SKIP);

    expect(Object.keys(result!)).toEqual(['mylib/sub']);
    expect(result!['mylib/sub']).toMatchObject({ singleton: true });
  });

  it('falls back to walking subfolders (readDir) when there is no exports map', () => {
    const io = createMemoryIo()
      .setFile(path.join(LIB, 'sub', 'package.json'), '{}')
      .setFile(path.join(LIB, 'node_modules', 'dep', 'package.json'), '{}');

    const result = getSecondaries(io, true, LIB, 'mylib', shareObject, EMPTY_SKIP);

    expect(Object.keys(result!)).toEqual(['mylib/sub']);
  });

  it('honours a custom skip list during the folder walk', () => {
    const io = createMemoryIo().setFile(path.join(LIB, 'sub', 'package.json'), '{}');

    const result = getSecondaries(
      io,
      { skip: ['mylib/sub'] },
      LIB,
      'mylib',
      shareObject,
      EMPTY_SKIP
    );

    expect(result).toEqual({});
  });
});

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
        overrides: { overridden: { singleton: false, requiredVersion: '~3.1.0', includeSecondaries: false } },
      },
      repo
    );

    expect(Object.keys(result!).sort()).toEqual(['mylib', 'overridden']);
    expect(result!['mylib']).toMatchObject({ singleton: true, requiredVersion: '^1.2.3' });
    expect(result!['overridden']).toMatchObject({ singleton: false, requiredVersion: '~3.1.0' });
  });
});
