import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { resolvePackageInfo } from './entry-point-resolver.js';
import { NOT_EXPORTED } from './exports-resolver.js';
import { createPackageJsonRepository } from '../io/package-json-repository.js';
import { createMemoryIo } from '../io/__test-helpers__/memory-io.js';
import { logger } from '../logger.js';

const WS = path.resolve('/ws');
const nm = (rel: string) => path.join(WS, 'node_modules', rel);

const repoWith = (pkgJson: object, extraFiles: Record<string, string> = {}) => {
  const io = createMemoryIo().setFile(nm('pkg/package.json'), JSON.stringify(pkgJson));
  for (const [rel, content] of Object.entries(extraFiles)) {
    io.setFile(nm(rel), content);
  }
  return createPackageJsonRepository(io);
};

describe('resolvePackageInfo', () => {
  it('resolves via the exports field, preferring ESM', () => {
    const repo = repoWith({
      version: '1.0.0',
      exports: { '.': { require: './cjs/index.js', import: './esm/index.js' } },
    });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info).toMatchObject({
      packageName: 'pkg',
      version: '1.0.0',
      esm: true,
      entryPoint: path.join(nm('pkg'), './esm/index.js'),
    });
  });

  it('reads a string exports field as the root entry', () => {
    const repo = repoWith({ version: '1.0.0', exports: './esm/index.js', main: './cjs/index.js' });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info?.entryPoint).toBe(path.join(nm('pkg'), './esm/index.js'));
  });

  it('does not fall back to module or main for a null exports target', () => {
    const repo = repoWith(
      {
        version: '1.0.0',
        exports: { '.': './index.js', './internal': null },
        module: './index.mjs',
        main: './index.js',
      },
      { 'pkg/internal/index.js': '', 'pkg/internal/package.json': '{"main":"./index.js"}' }
    );
    expect(resolvePackageInfo(repo, 'pkg/internal', WS, 'browser')).toBe(NOT_EXPORTED);
  });

  it('does not fall back to main when the root entry is null', () => {
    const repo = repoWith({ version: '1.0.0', exports: { '.': null }, main: './index.js' });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toBe(NOT_EXPORTED);
  });

  it("resolves the exports condition of the entry's platform", () => {
    const repo = repoWith({
      version: '1.0.0',
      exports: { '.': { node: './server.js', browser: './client.js' } },
    });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toMatchObject({
      entryPoint: path.join(nm('pkg'), './client.js'),
    });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'node')).toMatchObject({
      entryPoint: path.join(nm('pkg'), './server.js'),
    });
  });

  it('prefers exports over the top-level module field', () => {
    const repo = repoWith({ version: '1.0.0', exports: './e.js', module: './m.mjs' });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')?.entryPoint).toBe(
      path.join(nm('pkg'), './e.js')
    );
  });

  // Node throws ERR_PACKAGE_PATH_NOT_EXPORTED for these three; core moves on down the chain.
  // See package-resolution.md#differences-from-node.
  it('falls back for a subpath the exports map has no key for', () => {
    const repo = repoWith(
      { version: '1.0.0', exports: { '.': './m.js' } },
      { 'pkg/other/package.json': '{"main":"./o.js"}' }
    );
    expect(resolvePackageInfo(repo, 'pkg/other', WS, 'browser')).toMatchObject({
      packageName: 'pkg/other',
      entryPoint: path.join(nm('pkg/other'), './o.js'),
    });
  });

  it('falls back for a types-only exports object', () => {
    const repo = repoWith({
      version: '1.0.0',
      exports: { types: './t.d.ts' },
      module: './m.mjs',
    });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')?.entryPoint).toBe(
      path.join(nm('pkg'), './m.mjs')
    );
  });

  it('falls back when the conditions name only the other platform', () => {
    const repo = repoWith({
      version: '1.0.0',
      exports: { '.': { node: './n.js' } },
      module: './m.mjs',
    });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')?.entryPoint).toBe(
      path.join(nm('pkg'), './m.mjs')
    );
  });

  it('falls back to the top-level module field', () => {
    const repo = repoWith({ version: '2.0.0', module: './dist/index.mjs' });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info).toMatchObject({ esm: true, entryPoint: path.join(nm('pkg'), './dist/index.mjs') });
  });

  it('falls back to a conventional index.mjs', () => {
    const repo = repoWith({ version: '3.0.0' }, { 'pkg/index.mjs': '' });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info).toMatchObject({ esm: true, entryPoint: nm('pkg/index.mjs') });
  });

  it('falls back to the main field with esm derived from package type', () => {
    const repo = repoWith({ version: '4.0.0', main: './lib/index.js' });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info).toMatchObject({ esm: false, entryPoint: path.join(nm('pkg'), './lib/index.js') });
  });

  it('marks main esm when the package type is module', () => {
    const repo = repoWith({ version: '4.0.0', type: 'module', main: './lib/index.js' });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toMatchObject({ esm: true });
  });

  it('falls back to a conventional index.js', () => {
    const repo = repoWith({ version: '5.0.0' }, { 'pkg/index.js': '' });
    const info = resolvePackageInfo(repo, 'pkg', WS, 'browser');
    expect(info).toMatchObject({ entryPoint: nm('pkg/index.js') });
  });

  // Secondary entry points without exports, strategies 3 to 8 of the chain.
  describe('for a secondary entry point', () => {
    const resolveSub = (files: Record<string, string>) =>
      resolvePackageInfo(repoWith({ version: '7.0.0' }, files), 'pkg/sub', WS, 'browser');

    it("takes the subpath's own module field, with the package's version", () => {
      expect(
        resolveSub({
          'pkg/sub/package.json': '{"module":"./s.mjs","main":"./s.js","version":"0.0.1"}',
        })
      ).toMatchObject({
        packageName: 'pkg/sub',
        version: '7.0.0',
        esm: true,
        entryPoint: path.join(nm('pkg/sub'), './s.mjs'),
      });
    });

    it("prefers index.mjs over the subpath's main", () => {
      expect(
        resolveSub({ 'pkg/sub/package.json': '{"main":"./s.js"}', 'pkg/sub/index.mjs': '' })
      ).toMatchObject({ esm: true, entryPoint: nm('pkg/sub/index.mjs') });
    });

    it("prefers the subpath's main over index.js", () => {
      expect(
        resolveSub({ 'pkg/sub/package.json': '{"main":"./s.js"}', 'pkg/sub/index.js': '' })
      ).toMatchObject({ entryPoint: path.join(nm('pkg/sub'), './s.js') });
    });

    it('prefers index.js over <subpath>.js', () => {
      expect(resolveSub({ 'pkg/sub/index.js': '', 'pkg/sub.js': '' })).toMatchObject({
        entryPoint: nm('pkg/sub/index.js'),
      });
    });

    it('prefers <subpath>.js over <subpath>.mjs', () => {
      expect(resolveSub({ 'pkg/sub.js': '', 'pkg/sub.mjs': '' })).toMatchObject({
        entryPoint: nm('pkg/sub.js'),
      });
    });

    it('falls back to <subpath>.mjs', () => {
      expect(resolveSub({ 'pkg/sub.mjs': '' })).toMatchObject({ entryPoint: nm('pkg/sub.mjs') });
    });
  });

  it('returns null and logs a debug message when no version is present', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const repo = repoWith({ main: './index.js' });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toBeNull();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('No version'));
  });

  // A single probe of one candidate root: a miss is expected, so it must not warn.
  // Only getPackageInfo, after every root has failed, decides that is a problem.
  it('returns null and does not warn when no entry point can be resolved', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const repo = repoWith({ version: '6.0.0' });
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toBeNull();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('No entry point'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null when the dependency package.json is missing', () => {
    const repo = createPackageJsonRepository(createMemoryIo());
    vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    expect(resolvePackageInfo(repo, 'pkg', WS, 'browser')).toBeNull();
  });
});
