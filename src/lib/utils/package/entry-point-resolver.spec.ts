import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { resolvePackageInfo } from './entry-point-resolver.js';
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
    const info = resolvePackageInfo(repo, 'pkg', WS);
    expect(info).toMatchObject({
      packageName: 'pkg',
      version: '1.0.0',
      esm: true,
      entryPoint: path.join(nm('pkg'), './esm/index.js'),
    });
  });

  it('falls back to the top-level module field', () => {
    const repo = repoWith({ version: '2.0.0', module: './dist/index.mjs' });
    const info = resolvePackageInfo(repo, 'pkg', WS);
    expect(info).toMatchObject({ esm: true, entryPoint: path.join(nm('pkg'), './dist/index.mjs') });
  });

  it('falls back to a conventional index.mjs', () => {
    const repo = repoWith({ version: '3.0.0' }, { 'pkg/index.mjs': '' });
    const info = resolvePackageInfo(repo, 'pkg', WS);
    expect(info).toMatchObject({ esm: true, entryPoint: nm('pkg/index.mjs') });
  });

  it('falls back to the main field with esm derived from package type', () => {
    const repo = repoWith({ version: '4.0.0', main: './lib/index.js' });
    const info = resolvePackageInfo(repo, 'pkg', WS);
    expect(info).toMatchObject({ esm: false, entryPoint: path.join(nm('pkg'), './lib/index.js') });
  });

  it('falls back to a conventional index.js', () => {
    const repo = repoWith({ version: '5.0.0' }, { 'pkg/index.js': '' });
    const info = resolvePackageInfo(repo, 'pkg', WS);
    expect(info).toMatchObject({ entryPoint: nm('pkg/index.js') });
  });

  it('returns null and warns when no version is present', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const repo = repoWith({ main: './index.js' });
    expect(resolvePackageInfo(repo, 'pkg', WS)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No version'));
  });

  it('returns null and warns when no entry point can be resolved', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const repo = repoWith({ version: '6.0.0' });
    expect(resolvePackageInfo(repo, 'pkg', WS)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No entry point'));
  });

  it('returns null when the dependency package.json is missing', () => {
    const repo = createPackageJsonRepository(createMemoryIo());
    vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    expect(resolvePackageInfo(repo, 'pkg', WS)).toBeNull();
  });
});
