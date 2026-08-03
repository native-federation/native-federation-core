import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import {
  getPackageInfo,
  tryGetPackageInfo,
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
    const info = getPackageInfo('react', WS, seededRepo());
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
    expect(getPackageInfo('react', WS, seededRepo())).not.toBeNull();
    // A fresh, empty repository must not see anything from the previous call.
    const empty = createPackageJsonRepository(createMemoryIo());
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(getPackageInfo('react', WS, empty)).toBeNull();
    vi.restoreAllMocks();
  });

  it('getPackageInfo warns with an actionable hint when nothing resolves', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const empty = createPackageJsonRepository(createMemoryIo());

    expect(getPackageInfo('react', WS, empty)).toBeNull();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No meta data found'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('federation.config.js'));
    warn.mockRestore();
  });

  it('tryGetPackageInfo resolves identically but stays silent on failure', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(tryGetPackageInfo('react', WS, seededRepo())).toMatchObject({ packageName: 'react' });
    expect(
      tryGetPackageInfo('react', WS, createPackageJsonRepository(createMemoryIo()))
    ).toBeNull();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
      tryGetPackageInfo('@scope/lib', WS, repo)?.version
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
