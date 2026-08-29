import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  affectedSharedKeys,
  hintUnwatchedLinkedDeps,
  linkedContentSignals,
  linkedSharedDirs,
  resolveSharedPackageDirs,
  sharedMappingDirs,
} from './resolve-shared-dirs.js';
import { createMemoryIo } from '../../utils/io/__test-helpers__/memory-io.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { logger } from '../../utils/logger.js';

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

  const config = {
    shared: { '@scope/lib': {}, missing: {} },
  } as unknown as NormalizedFederationConfig;
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
  // The watch set is opt-in; these cases are about classification, so they enable it.
  const watching = (shared: Record<string, unknown>) =>
    ({ shared }) as unknown as NormalizedFederationConfig;
  const opts = { workspaceRoot: '/ws', watchLinkedDeps: true } as NormalizedFederationOptions;

  function repoReturning(map: Record<string, string | null>): PackageJsonRepository {
    return {
      findDepPackageJson: (name: string) => map[name] ?? null,
      getPackageJsonFiles: () => [],
      readJson: () => ({}),
      exists: () => true,
    };
  }

  it('returns realpath dirs of symlinked packages only, deduped', () => {
    const cfg = watching({ '@scope/lib': {}, '@scope/lib/sub': {}, tslib: {} });

    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setSymlink('/ws/node_modules/@scope/lib/sub', '/dev/lib');
    const repo = repoReturning({
      '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
      // secondary resolves to the same main package dir (symlinked)
      '@scope/lib/sub': '/ws/node_modules/@scope/lib/package.json',
      tslib: '/ws/node_modules/tslib/package.json',
    });

    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual(['/dev/lib']);
  });

  // A registry dep is bundled once and cached by checksum, so watching node_modules can
  // never change an outcome; only a linked checkout can, and that is opt-in.
  it('watches nothing unless watchLinkedDeps is enabled', () => {
    const cfg = watching({ '@scope/lib': {} });
    const io = createMemoryIo().setSymlink('/ws/node_modules/@scope/lib', '/dev/lib');
    const repo = repoReturning({ '@scope/lib': '/ws/node_modules/@scope/lib/package.json' });
    const off = { workspaceRoot: '/ws' } as NormalizedFederationOptions;

    expect(linkedSharedDirs(cfg, off, io, repo)).toEqual([]);
    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual(['/dev/lib']);
  });

  // pnpm's default (isolated) nodeLinker symlinks *every* dependency into the virtual
  // store, so a bare lstat test classifies the whole graph as npm-linked. angular-adapter#130.
  it('does not treat a package-manager symlink into node_modules as linked', () => {
    const cfg = watching({ rxjs: {}, '@scope/lib': {} });

    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/rxjs', '/ws/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs')
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib/dist');
    const repo = repoReturning({
      rxjs: '/ws/node_modules/rxjs/package.json',
      '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
    });

    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual(['/dev/lib/dist']);
  });

  // The virtual store can sit above the Angular workspace root in a monorepo, so the
  // rule matches a node_modules segment anywhere rather than under workspaceRoot.
  it('rejects a store that sits above the workspace root', () => {
    const cfg = watching({ rxjs: {} });

    const io = createMemoryIo().setSymlink(
      '/repo/apps/host/node_modules/rxjs',
      '/repo/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs'
    );
    const repo = repoReturning({ rxjs: '/repo/apps/host/node_modules/rxjs/package.json' });

    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual([]);
  });

  // Substring matching would read this checkout as an installed package and silently
  // switch the feature off for it.
  it('treats a checkout whose path merely contains the text node_modules as linked', () => {
    const cfg = watching({ 'my-lib': {} });

    const io = createMemoryIo().setSymlink(
      '/ws/node_modules/my-lib',
      '/dev/node_modules_backup/my-lib/dist'
    );
    const repo = repoReturning({ 'my-lib': '/ws/node_modules/my-lib/package.json' });

    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual(['/dev/node_modules_backup/my-lib/dist']);
  });

  // `npm link` installs two hops; realpath collapses both to the checkout, which carries
  // no node_modules segment, so the feature survives the narrowed test.
  it('follows a two-hop npm-link chain to the dev checkout', () => {
    const cfg = watching({ 'my-lib': {} });

    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/my-lib', '/usr/lib/node_modules/my-lib')
      .setSymlink('/usr/lib/node_modules/my-lib', '/dev/mylib-checkout/dist');
    const repo = repoReturning({ 'my-lib': '/ws/node_modules/my-lib/package.json' });

    expect(linkedSharedDirs(cfg, opts, io, repo)).toEqual(['/dev/mylib-checkout/dist']);
  });
});

describe('hintUnwatchedLinkedDeps', () => {
  const notice = vi.spyOn(logger, 'notice').mockImplementation(() => undefined);
  afterEach(() => notice.mockClear());

  const cfg = (shared: Record<string, unknown>) =>
    ({ shared }) as unknown as NormalizedFederationConfig;
  const watching = { workspaceRoot: '/ws', watch: true } as NormalizedFederationOptions;

  function repoReturning(map: Record<string, string | null>): PackageJsonRepository {
    return {
      findDepPackageJson: (name: string) => map[name] ?? null,
      getPackageJsonFiles: () => [],
      readJson: () => ({}),
      exists: () => true,
    };
  }

  const linkedIo = () => createMemoryIo().setSymlink('/ws/node_modules/@scope/lib', '/dev/lib');
  const linkedRepo = () =>
    repoReturning({ '@scope/lib': '/ws/node_modules/@scope/lib/package.json' });

  it('names the linked package the watch is skipping', () => {
    hintUnwatchedLinkedDeps(cfg({ '@scope/lib': {} }), watching, linkedIo(), linkedRepo());

    expect(notice).toHaveBeenCalledTimes(1);
    const message = String(notice.mock.calls[0]![0]);
    expect(message).toContain('@scope/lib');
    expect(message).toContain('watchLinkedDeps');
  });

  // Only the package is linked, so naming the raw key would point at a path that is not
  // the thing the user linked.
  it('names the package, not the secondary entry point that is shared', () => {
    hintUnwatchedLinkedDeps(
      cfg({ '@scope/lib/sub': {} }),
      watching,
      linkedIo(),
      repoReturning({ '@scope/lib/sub': '/ws/node_modules/@scope/lib/package.json' })
    );

    expect(String(notice.mock.calls[0]![0])).toContain('packages: @scope/lib.');
  });

  // Secondaries resolve to their main package's dir, so they must not each add a name.
  it('names a package once however many entry points share it', () => {
    hintUnwatchedLinkedDeps(
      cfg({ '@scope/lib': {}, '@scope/lib/sub': {} }),
      watching,
      linkedIo(),
      repoReturning({
        '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
        '@scope/lib/sub': '/ws/node_modules/@scope/lib/package.json',
      })
    );

    expect(String(notice.mock.calls[0]![0])).toContain('packages: @scope/lib.');
  });

  it('stays quiet when the option is already on', () => {
    hintUnwatchedLinkedDeps(
      cfg({ '@scope/lib': {} }),
      { ...watching, watchLinkedDeps: true },
      linkedIo(),
      linkedRepo()
    );

    expect(notice).not.toHaveBeenCalled();
  });

  // A one-off build reloads nothing either way, so the option would change nothing.
  it('stays quiet when the build is not watching', () => {
    hintUnwatchedLinkedDeps(
      cfg({ '@scope/lib': {} }),
      { workspaceRoot: '/ws' } as NormalizedFederationOptions,
      linkedIo(),
      linkedRepo()
    );

    expect(notice).not.toHaveBeenCalled();
  });

  // The #130 shape: pnpm symlinks the whole graph, and none of it is a dev checkout.
  it('stays quiet for a symlink that resolves inside node_modules', () => {
    hintUnwatchedLinkedDeps(
      cfg({ rxjs: {} }),
      watching,
      createMemoryIo().setSymlink(
        '/ws/node_modules/rxjs',
        '/ws/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs'
      ),
      repoReturning({ rxjs: '/ws/node_modules/rxjs/package.json' })
    );

    expect(notice).not.toHaveBeenCalled();
  });

  it('stays quiet when nothing is linked', () => {
    hintUnwatchedLinkedDeps(cfg({ rxjs: {} }), watching, createMemoryIo(), repoReturning({}));

    expect(notice).not.toHaveBeenCalled();
  });

  // The hint is advisory: a repo that cannot resolve must not take the build down with it.
  it('swallows a resolution failure instead of failing the build', () => {
    const throwing = {
      ...repoReturning({}),
      findDepPackageJson: () => {
        throw new Error('unresolvable');
      },
    } as PackageJsonRepository;

    expect(() =>
      hintUnwatchedLinkedDeps(cfg({ '@scope/lib': {} }), watching, linkedIo(), throwing)
    ).not.toThrow();
    expect(notice).not.toHaveBeenCalled();
  });
});

describe('sharedMappingDirs', () => {
  const dirsFor = (sharedMappings: Record<string, string>): string[] =>
    sharedMappingDirs({ sharedMappings } as unknown as NormalizedFederationConfig);

  // getRawMappedPaths keys config.sharedMappings by the absolute entry-point file.
  it('returns the source dir of each mapping entry point', () => {
    expect(
      dirsFor({
        '/ws/libs/shell/src/index.ts': '@apex/shell',
        '/ws/libs/ui/src/index.ts': '@apex/ui',
      })
    ).toEqual(['/ws/libs/shell/src', '/ws/libs/ui/src']);
  });

  it('dedupes libs that expose several entry points from one dir', () => {
    expect(
      dirsFor({
        '/ws/libs/ui/src/index.ts': '@apex/ui',
        '/ws/libs/ui/src/testing.ts': '@apex/ui/testing',
      })
    ).toEqual(['/ws/libs/ui/src']);
  });

  it('drops a mapping resolving into node_modules', () => {
    expect(
      dirsFor({
        '/ws/node_modules/@apex/vendor/index.ts': '@apex/vendor',
        '/ws/libs/ui/src/index.ts': '@apex/ui',
      })
    ).toEqual(['/ws/libs/ui/src']);
  });

  it('returns empty when nothing is mapped', () => {
    expect(dirsFor({})).toEqual([]);
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

  it('emits no signal for a package-manager symlink into node_modules', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/tslib', '/ws/node_modules/.pnpm/tslib@2.6.2/node_modules/tslib')
      .setFile('/ws/node_modules/.pnpm/tslib@2.6.2/node_modules/tslib/index.js', 'T')
      .setMtime('/ws/node_modules/.pnpm/tslib@2.6.2/node_modules/tslib/index.js', 900);

    expect(linkedContentSignals(['tslib'], '/ws', io, repo)).toEqual({});
  });

  it('walks each unique package dir once, however many keys resolve to it', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setSymlink('/ws/node_modules/@scope/lib/sub', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100);
    const multiEntry = repoReturning({
      '@scope/lib': '/ws/node_modules/@scope/lib/package.json',
      '@scope/lib/sub': '/ws/node_modules/@scope/lib/package.json',
    });
    const readDir = vi.spyOn(io, 'readDir');

    const signals = linkedContentSignals(['@scope/lib', '@scope/lib/sub'], '/ws', io, multiEntry);

    expect(signals).toEqual({ '@scope/lib': '100', '@scope/lib/sub': '100' });
    expect(readDir.mock.calls.filter(([dir]) => dir === '/dev/lib')).toHaveLength(1);
  });

  // bundle-shared marks only shared keys external, so a dep installed inside the linked
  // checkout is compiled into the external and has to move the signal — an `npm install`
  // in the checkout changes the emitted bundle while the shared version stays put.
  it('includes a real nested node_modules in the signal', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100)
      .setFile('/dev/lib/node_modules/dep/index.js', 'D')
      .setMtime('/dev/lib/node_modules/dep/index.js', 900);

    expect(linkedContentSignals(['@scope/lib'], '/ws', io, repo)['@scope/lib']).toBe('900');
  });

  // The escape the walk actually has to guard: io.isDirectory follows links, so descending
  // one leaves the package. Deliberately not named node_modules — the old name-based skip
  // happened to cover that one path and nothing else.
  it('does not descend a symlinked directory', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100)
      // A symlinked dir: lstat reports the link, isDirectory follows it to a real dir.
      .setDir('/other/pkg')
      .setSymlink('/dev/lib/vendor', '/other/pkg')
      .setFile('/other/pkg/index.js', 'D')
      .setMtime('/other/pkg/index.js', 900);

    expect(linkedContentSignals(['@scope/lib'], '/ws', io, repo)['@scope/lib']).toBe('100');
  });

  // Same guard, and the case that would otherwise not terminate: descending `self` reads
  // /dev/lib again, whose own `self` reads it again. Counting reads is what pins this down —
  // the signal alone stays 100 either way.
  it('does not follow a symlink pointing back at an ancestor', () => {
    const io = createMemoryIo()
      .setSymlink('/ws/node_modules/@scope/lib', '/dev/lib')
      .setFile('/dev/lib/a.js', 'A')
      .setMtime('/dev/lib/a.js', 100)
      .setSymlink('/dev/lib/self', '/dev/lib');
    const readDir = vi.spyOn(io, 'readDir');

    expect(linkedContentSignals(['@scope/lib'], '/ws', io, repo)['@scope/lib']).toBe('100');
    expect(readDir).toHaveBeenCalledTimes(1);
  });
});
