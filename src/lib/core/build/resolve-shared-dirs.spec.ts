import { describe, expect, it } from 'vitest';
import {
  affectedSharedKeys,
  linkedContentSignals,
  linkedSharedDirs,
  resolveSharedPackageDirs,
} from './resolve-shared-dirs.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';

describe('affectedSharedKeys', () => {
  const dirs = new Map([
    ['@scope/lib', '/dev/lib/dist'],
    ['tslib', '/ws/node_modules/tslib'],
  ]);

  it('flags a package when a modified file lives under its directory', () => {
    const io = createMemoryIo();
    const affected = affectedSharedKeys(['/dev/lib/dist/src/a.js'], dirs, io);
    expect([...affected]).toEqual(['@scope/lib']);
  });

  it('resolves symlinked modified paths before matching', () => {
    const io = createMemoryIo().setSymlink('/ws/node_modules/@scope/lib', '/dev/lib/dist');
    const affected = affectedSharedKeys(['/ws/node_modules/@scope/lib/src/a.js'], dirs, io);
    expect([...affected]).toEqual(['@scope/lib']);
  });

  it('returns empty when no modified file matches a shared dir', () => {
    const io = createMemoryIo();
    expect(affectedSharedKeys(['/somewhere/else/a.js'], dirs, io).size).toBe(0);
    expect(affectedSharedKeys([], dirs, io).size).toBe(0);
  });

  it('does not match a sibling dir sharing a name prefix', () => {
    const io = createMemoryIo();
    const affected = affectedSharedKeys(['/dev/lib-extra/src/a.js'], dirs, io);
    expect(affected.size).toBe(0);
  });
});

describe('resolveSharedPackageDirs', () => {
  function repoReturning(map: Record<string, string | null>): PackageJsonRepository {
    return {
      findDepPackageJson: (name: string) => map[name] ?? null,
      getPackageJsonFiles: () => [],
      readJson: () => ({}),
      exists: () => true,
    };
  }

  const config = { shared: { '@scope/lib': {}, missing: {} } } as unknown as NormalizedFederationConfig;
  const fedOptions = { workspaceRoot: '/ws' } as NormalizedFederationOptions;

  it('maps each key to its realpath, following symlinks', () => {
    const io = createMemoryIo().setSymlink('/ws/node_modules/@scope/lib', '/dev/lib');
    const repo = repoReturning({ '@scope/lib': '/ws/node_modules/@scope/lib/package.json' });

    const dirs = resolveSharedPackageDirs(config, fedOptions, io, repo);
    expect(dirs.get('@scope/lib')).toBe('/dev/lib');
  });

  it('skips keys whose package.json cannot be resolved', () => {
    const io = createMemoryIo();
    const repo = repoReturning({ '@scope/lib': '/ws/node_modules/@scope/lib/package.json' });

    const dirs = resolveSharedPackageDirs(config, fedOptions, io, repo);
    expect(dirs.has('missing')).toBe(false);
  });
});

describe('linkedSharedDirs', () => {
  function repoReturning(map: Record<string, string | null>): PackageJsonRepository {
    return {
      findDepPackageJson: (name: string) => map[name] ?? null,
      getPackageJsonFiles: () => [],
      readJson: () => ({}),
      exists: () => true,
    };
  }

  it('returns realpath dirs of symlinked packages only, deduped', () => {
    const cfg = {
      shared: { '@scope/lib': {}, '@scope/lib/sub': {}, tslib: {} },
    } as unknown as NormalizedFederationConfig;
    const fedOptions = { workspaceRoot: '/ws' } as NormalizedFederationOptions;

    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setSymlink('/ws/node_modules/@scope/lib/sub', '/dev/lib');
    const repo = repoReturning({
      '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
      // secondary resolves to the same main package dir (symlinked)
      '@scope/lib/sub': '/ws/node_modules/@scope/lib/package.json',
      tslib: '/ws/node_modules/tslib/package.json',
    });

    expect(linkedSharedDirs(cfg, fedOptions, io, repo)).toEqual(['/dev/lib']);
  });
});

describe('linkedContentSignals', () => {
  function repoReturning(map: Record<string, string | null>): PackageJsonRepository {
    return {
      findDepPackageJson: (name: string) => map[name] ?? null,
      getPackageJsonFiles: () => [],
      readJson: () => ({}),
      exists: () => true,
    };
  }

  const repo = repoReturning({
    '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
    tslib: '/ws/node_modules/tslib/package.json',
  });

  it('emits a max-mtime signal for symlinked packages only', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100)
      .setFile('/dev/lib/nested/b.js', 'B')
      .setMtime('/dev/lib/nested/b.js', 300)
      // tslib is a real (non-symlink) dir → no signal.
      .setFile('/ws/node_modules/tslib/index.js', 'T');

    const signals = linkedContentSignals(['@scope/lib', 'tslib'], '/ws', io, repo);

    expect(signals['@scope/lib']).toBe('300');
    expect(signals).not.toHaveProperty('tslib');
  });

  it('tracks the newest mtime so an edit changes the signal', () => {
    const build = (mtime: number) =>
      linkedContentSignals(
        ['@scope/lib'],
        '/ws',
        createMemoryIo()
          .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
          .setFile('/dev/lib/a.js', 'A')
          .setMtime('/dev/lib/a.js', mtime),
        repo
      )['@scope/lib'];

    expect(build(100)).toBe('100');
    expect(build(100)).toBe('100');
    expect(build(200)).not.toBe('100');
  });

  it('follows a symlinked file to its target mtime, not the link mtime', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100)
      // b.js is itself a symlink; its target is newer than any lstat mtime in the dir.
      .setFile('/dev/lib/b.js', 'B')
      .setSymlink('/dev/lib/b.js', '/other/b-real.js')
      .setMtime('/dev/lib/b.js', 200)
      .setFile('/other/b-real.js', 'BR')
      .setMtime('/other/b-real.js', 500);

    const signals = linkedContentSignals(['@scope/lib'], '/ws', io, repo);

    expect(signals['@scope/lib']).toBe('500');
  });
});
