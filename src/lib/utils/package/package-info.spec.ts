import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import {
  getPackageInfo,
  getVersionMaps,
  findDepPackageJson,
  installedVersions,
} from './package-info.js';
import { createPackageJsonRepository } from '../io/package-json-repository.js';
import { createMemoryIo } from '../io/__test-helpers__/memory-io.js';
import { logger } from '../logger.js';

const WS = path.resolve('/ws');

const seededRepo = () => {
  const io = createMemoryIo()
    .setFile(path.join(WS, 'package.json'), JSON.stringify({ dependencies: { react: '18.0.0' } }))
    .setFile(
      path.join(WS, 'node_modules/react/package.json'),
      JSON.stringify({ version: '18.0.0', module: './index.mjs' })
    );
  return createPackageJsonRepository(io);
};

describe('package-info facade (with injected repository)', () => {
  it('getPackageInfo resolves an installed dependency', () => {
    const info = getPackageInfo('react', WS, seededRepo(), 'browser');
    expect(info).toMatchObject({ packageName: 'react', version: '18.0.0', esm: true });
  });

  it('getVersionMaps reads the dependency versions', () => {
    expect(getVersionMaps(WS, WS, seededRepo())).toEqual([{ react: '18.0.0' }]);
  });

  it('findDepPackageJson locates the dependency package.json', () => {
    expect(findDepPackageJson('react', WS, seededRepo())).toBe(
      path.join(WS, 'node_modules/react/package.json')
    );
  });

  it('does not leak state across calls using independent repositories', () => {
    expect(getPackageInfo('react', WS, seededRepo(), 'browser')).not.toBeNull();
    // A fresh, empty repository must not see anything from the previous call.
    const empty = createPackageJsonRepository(createMemoryIo());
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(getPackageInfo('react', WS, empty, 'browser')).toBeNull();
    vi.restoreAllMocks();
  });

  it('getPackageInfo warns with an actionable hint when nothing resolves', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const empty = createPackageJsonRepository(createMemoryIo());

    expect(getPackageInfo('react', WS, empty, 'browser')).toBeNull();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No meta data found'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('federation.config.js'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('into devDependencies'));
    warn.mockRestore();
  });

  it.each([
    ['maps to null', null],
    ['maps to an array with no valid target', ['../outside.js']],
  ])('getPackageInfo says the exports block an entry point the package %s', (_, target) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile(path.join(WS, 'package.json'), JSON.stringify({ dependencies: { lib: '1.0.0' } }))
      .setFile(
        path.join(WS, 'node_modules/lib/package.json'),
        JSON.stringify({ version: '1.0.0', exports: { '.': target }, main: './index.js' })
      );
    const repo = createPackageJsonRepository(io);

    expect(getPackageInfo('lib', WS, repo, 'browser')).toBeNull();

    expect(warn).toHaveBeenCalledWith(
      'No meta data found for shared lib lib: its package.json exports blocks this entry point'
    );
    // A blocked entry point stays blocked wherever the package is listed in package.json.
    expect(warn).toHaveBeenCalledWith(
      'Skip it in your federation.config.js, or remove it from shared'
    );
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  // The production repository lists only the workspace root here, so the loop sees one folder
  // today; this pins what a second folder would get: the first folder's "not exported" ends the
  // search, as a resolved entry does.
  it('stops at the first package.json folder whose package blocks the entry point', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const first = path.join(WS, 'first');
    const second = path.join(WS, 'second');
    const io = createMemoryIo()
      .setFile(
        path.join(first, 'node_modules/lib/package.json'),
        JSON.stringify({ version: '1.0.0', exports: { '.': null } })
      )
      .setFile(
        path.join(second, 'node_modules/lib/package.json'),
        JSON.stringify({ version: '2.0.0', exports: { '.': './index.js' } })
      );
    const base = createPackageJsonRepository(io);
    const repo = {
      ...base,
      getPackageJsonFiles: () => [
        { content: {}, directory: first },
        { content: {}, directory: second },
      ],
    };

    expect(getPackageInfo('lib', WS, repo, 'browser')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'No meta data found for shared lib lib: its package.json exports blocks this entry point'
    );
    warn.mockRestore();
  });

  it('passes the platform through to the exports conditions', () => {
    const io = createMemoryIo()
      .setFile(path.join(WS, 'package.json'), JSON.stringify({ dependencies: { lib: '1.0.0' } }))
      .setFile(
        path.join(WS, 'node_modules/lib/package.json'),
        JSON.stringify({
          version: '1.0.0',
          exports: { node: './server.js', browser: './client.js' },
        })
      );
    const repo = createPackageJsonRepository(io);
    const lib = path.join(WS, 'node_modules/lib');

    expect(getPackageInfo('lib', WS, repo, 'node')?.entryPoint).toBe(path.join(lib, 'server.js'));
    expect(getPackageInfo('lib', WS, repo, 'browser')?.entryPoint).toBe(
      path.join(lib, 'client.js')
    );
  });
});

describe('installedVersions', () => {
  const versionsIo = () =>
    createMemoryIo()
      .setFile(path.join(WS, 'package.json'), JSON.stringify({ dependencies: {} }))
      .setFile(
        path.join(WS, 'node_modules/@scope/lib/package.json'),
        JSON.stringify({ version: '2.5.0', module: './index.mjs' })
      )
      // Secondary entry points ship their own package.json, typically without a version:
      // the root's version is what PackageInfo records for them.
      .setFile(
        path.join(WS, 'node_modules/@scope/lib/testing/package.json'),
        JSON.stringify({ module: './index.mjs' })
      )
      .setFile(
        path.join(WS, 'node_modules/react/package.json'),
        JSON.stringify({ version: '18.0.0', module: './index.mjs' })
      );

  it('resolves each key to the installed version of its package root', () => {
    const repo = createPackageJsonRepository(versionsIo());

    expect(installedVersions(['@scope/lib', '@scope/lib/testing', 'react'], WS, repo)).toEqual({
      '@scope/lib': '2.5.0',
      '@scope/lib/testing': '2.5.0',
      react: '18.0.0',
    });
  });

  it('agrees with the version PackageInfo records, which is what the cache metadata stores', () => {
    const repo = createPackageJsonRepository(versionsIo());

    expect(installedVersions(['@scope/lib'], WS, repo)['@scope/lib']).toBe(
      getPackageInfo('@scope/lib', WS, repo, 'browser')?.version
    );
  });

  it('maps an unresolvable package to an empty string', () => {
    const repo = createPackageJsonRepository(versionsIo());

    expect(installedVersions(['not-installed'], WS, repo)).toEqual({ 'not-installed': '' });
  });

  it('maps a package.json without a version to an empty string', () => {
    const io = versionsIo().setFile(
      path.join(WS, 'node_modules/no-version/package.json'),
      JSON.stringify({ module: './index.mjs' })
    );

    expect(installedVersions(['no-version'], WS, createPackageJsonRepository(io))).toEqual({
      'no-version': '',
    });
  });

  it('resolves once per package root, not once per key', () => {
    const base = createPackageJsonRepository(versionsIo());
    const findDep = vi.fn(base.findDepPackageJson);
    const repo = { ...base, findDepPackageJson: findDep };

    installedVersions(
      ['@scope/lib', '@scope/lib/testing', '@scope/lib/rxjs-interop', 'react'],
      WS,
      repo
    );

    expect(findDep).toHaveBeenCalledTimes(2);
  });
});
