import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { createPackageJsonRepository, getPkgFolder } from './package-json-repository.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { logger } from '../utils/logger.js';

const abs = (p: string) => path.resolve(p);

describe('getPkgFolder', () => {
  it('returns the first segment for an unscoped package', () => {
    expect(getPkgFolder('lodash/fp')).toBe('lodash');
  });

  it('keeps the scope for a scoped package', () => {
    expect(getPkgFolder('@angular/core/testing')).toBe('@angular/core');
  });
});

describe('createPackageJsonRepository', () => {
  it('collects package.json files from project up to workspace, nearest first', () => {
    const io = createMemoryIo()
      .setFile(abs('/ws/package.json'), JSON.stringify({ name: 'root' }))
      .setFile(abs('/ws/libs/a/package.json'), JSON.stringify({ name: 'a' }));
    const repo = createPackageJsonRepository(io);

    const files = repo.getPackageJsonFiles(abs('/ws/libs/a'), abs('/ws'));
    expect(files.map(f => f.content.name)).toEqual(['a', 'root']);
  });

  it('throws when workspace is not an ancestor of project', () => {
    const repo = createPackageJsonRepository(createMemoryIo());
    expect(() => repo.getPackageJsonFiles(abs('/other'), abs('/ws'))).toThrow(
      /needs to be a parent/
    );
  });

  it('caches results per (project, workspace) key', () => {
    const io = createMemoryIo().setFile(abs('/ws/package.json'), JSON.stringify({ name: 'r' }));
    const repo = createPackageJsonRepository(io);

    const first = repo.getPackageJsonFiles(abs('/ws'), abs('/ws'));
    const second = repo.getPackageJsonFiles(abs('/ws'), abs('/ws'));
    expect(second).toBe(first);
  });

  it('does not leak cache state between repository instances', () => {
    const io = createMemoryIo().setFile(abs('/ws/package.json'), JSON.stringify({ name: 'r' }));
    const a = createPackageJsonRepository(io);
    const b = createPackageJsonRepository(io);
    expect(b.getPackageJsonFiles(abs('/ws'), abs('/ws'))).not.toBe(
      a.getPackageJsonFiles(abs('/ws'), abs('/ws'))
    );
  });

  describe('findDepPackageJson', () => {
    it('finds a dependency in the nearest node_modules walking up', () => {
      const io = createMemoryIo().setFile(
        abs('/ws/node_modules/react/package.json'),
        JSON.stringify({ version: '18.0.0' })
      );
      const repo = createPackageJsonRepository(io);

      expect(repo.findDepPackageJson('react', abs('/ws/libs/a'))).toBe(
        abs('/ws/node_modules/react/package.json')
      );
    });

    it('resolves a scoped dependency folder', () => {
      const io = createMemoryIo().setFile(
        abs('/ws/node_modules/@angular/core/package.json'),
        JSON.stringify({ version: '17.0.0' })
      );
      const repo = createPackageJsonRepository(io);

      expect(repo.findDepPackageJson('@angular/core', abs('/ws'))).toBe(
        abs('/ws/node_modules/@angular/core/package.json')
      );
    });

    it('returns null and logs when the dependency cannot be found', () => {
      const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
      const repo = createPackageJsonRepository(createMemoryIo());

      expect(repo.findDepPackageJson('missing', abs('/ws'))).toBeNull();
      expect(verbose).toHaveBeenCalled();
    });
  });
});
