import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import semver from 'semver';
import { fromPackageJson, shareAllCore, shareCore } from './share-utils.js';
import { DEFAULT_SKIP_LIST } from './default-skip-list.js';
import { logger } from '../utils/logger.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import { createPackageJsonRepository } from '../utils/io/package-json-repository.js';
import { useWorkspace } from './configuration-context.js';
import type { ShareAllExternalsOptions } from '../domain/config/external-config.contract.js';

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

  // core#233: shareAngularLocales shares '@angular/common/locales/nl' with a hand-written packageInfo.
  describe('a sub-path key', () => {
    const withLib = (name: string) => {
      const io = createMemoryIo()
        .setFile(path.join(PROJECT, 'package.json'), '{}')
        .setFile(
          path.join(PROJECT, 'node_modules', name, 'package.json'),
          JSON.stringify({
            version: '1.2.3',
            type: 'module',
            exports: { '.': './index.js', './sub': { default: './sub/index.js' } },
          })
        );
      return { io, repo: createPackageJsonRepository(io) };
    };

    it.each(['mylib', '@org/lib'])(
      'does not expand the package root secondaries under %s/sub',
      name => {
        const { io, repo } = withLib(name);
        const key = `${name}/sub`;

        const result = shareCore(
          io,
          {
            [key]: {
              requiredVersion: '^1.0.0',
              includeSecondaries: true,
              packageInfo: { entryPoint: 'sub.js', esm: true },
            },
          },
          PROJECT,
          DEFAULT_SKIP_LIST,
          repo
        );

        expect(Object.keys(result)).toEqual([key]);
      }
    );

    // As fromPackageJson().override(share(...)) runs it: no doubled keys, no rewritten values.
    it.each([
      ['literal range', { requiredVersion: '^1.0.0' }],
      ["'auto'", { requiredVersion: 'auto' }],
    ])('keeps every value through a second pass, with a %s', (_label, cfg) => {
      const { io, repo } = withLib('mylib');
      io.setFile(
        path.join(PROJECT, 'package.json'),
        JSON.stringify({ dependencies: { mylib: '^1.0.0' } })
      );

      const once = shareCore(io, { mylib: cfg }, PROJECT, DEFAULT_SKIP_LIST, repo);
      const twice = shareCore(io, once, PROJECT, DEFAULT_SKIP_LIST, repo);

      expect(twice).toEqual(once);
    });
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
      {
        mylib: { singleton: true, requiredVersion: { range: 'minor' }, includeSecondaries: false },
      },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    const rPatch = shareCore(
      io,
      {
        mylib: { singleton: true, requiredVersion: { range: 'patch' }, includeSecondaries: false },
      },
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

  // core#247: the secondaries lookup for an uninstalled override walked a relative path forever.
  it('completes for a relative projectPath with an override that is not installed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    // memory-io resolves relative keys against cwd, as nodeIo would
    const memory = createMemoryIo().setFile(
      path.resolve('packages/app/package.json'),
      JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
    );
    let probes = 0;
    const io = {
      ...memory,
      exists: (p: string) => {
        if (++probes > 200) throw new Error('walk did not terminate');
        return memory.exists(p);
      },
    };
    const repo = createPackageJsonRepository(io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      {
        projectPath: 'packages/app',
        overrides: { '@not/exist': { singleton: true, strictVersion: false } },
      },
      repo
    );

    expect(Object.keys(result!).sort()).toEqual(['@not/exist', 'mylib']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not find @not/exist in any node_modules above ${path.resolve('packages/app')}`
      )
    );
    warn.mockRestore();
    verbose.mockRestore();
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

  // An override key used to act as a name prefix, so `react` also removed `react-dom`.
  describe('an override names one package', () => {
    const reactDeps = (extra: Record<string, string> = {}) => {
      const io = createMemoryIo().setFile(
        path.join(PROJECT, 'package.json'),
        JSON.stringify({
          dependencies: {
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'react-router': '^7.0.0',
            ...extra,
          },
        })
      );
      return { io, repo: createPackageJsonRepository(io) };
    };
    const reactOverride = {
      react: { singleton: false, requiredVersion: '~19.1.0', includeSecondaries: false },
    };

    it('keeps packages whose name starts with the override key', () => {
      const { io, repo } = reactDeps();

      const result = shareAllCore(
        io,
        { singleton: true, includeSecondaries: false },
        { projectPath: PROJECT, overrides: reactOverride },
        repo
      );

      expect(Object.keys(result!).sort()).toEqual(['react', 'react-dom', 'react-router']);
      expect(result!['react']).toMatchObject({ singleton: false, requiredVersion: '~19.1.0' });
      expect(result!['react-dom']).toMatchObject({ singleton: true, requiredVersion: '^19.0.0' });
      expect(result!['react-router']).toMatchObject({ singleton: true, requiredVersion: '^7.0.0' });
    });

    it('keeps a scoped package that extends the override key', () => {
      const io = createMemoryIo().setFile(
        path.join(PROJECT, 'package.json'),
        JSON.stringify({ dependencies: { '@scope/pkg': '^1.0.0', '@scope/pkg-extra': '^1.0.0' } })
      );
      const repo = createPackageJsonRepository(io);

      const result = shareAllCore(
        io,
        { singleton: true, includeSecondaries: false },
        {
          projectPath: PROJECT,
          overrides: { '@scope/pkg': { singleton: false, includeSecondaries: false } },
        },
        repo
      );

      expect(Object.keys(result!).sort()).toEqual(['@scope/pkg', '@scope/pkg-extra']);
      expect(result!['@scope/pkg-extra']).toMatchObject({ singleton: true });
    });

    it('applies a patch to a package whose name starts with the override key', () => {
      const { io, repo } = reactDeps();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = shareAllCore(
        io,
        { singleton: true, includeSecondaries: false },
        {
          projectPath: PROJECT,
          overrides: reactOverride,
          patches: [{ patterns: ['react-dom'], cfg: { strictVersion: true } }],
        },
        repo
      );

      expect(result!['react-dom']).toMatchObject({ singleton: true, strictVersion: true });
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('react-dom'));
      warn.mockRestore();
    });

    it('reports a patch on an unknown package as matching nothing, not as overridden', () => {
      const { io, repo } = reactDeps();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      shareAllCore(
        io,
        { singleton: true, includeSecondaries: false },
        {
          projectPath: PROJECT,
          overrides: reactOverride,
          patches: [{ patterns: ['react-foo'], cfg: { strictVersion: true } }],
        },
        repo
      );

      const patchWarnings = warn.mock.calls
        .map(([m]) => String(m))
        .filter(m => m.includes('react-foo'));
      expect(patchWarnings).toHaveLength(1);
      expect(patchWarnings[0]).toContain('matches no shared package');
      warn.mockRestore();
    });
  });
});

// fromPackageJson reads through nodeIo, so these run against this repo's own package.json; they
// compare selections with each other, not with fixed keys.
describe('fromPackageJson().only()', () => {
  const ROOT = process.cwd();
  const keys = (shared: object) => Object.keys(shared).sort();

  it('selects as filter() does', () => {
    const only = fromPackageJson({ singleton: true }, ROOT).only(['chalk']).get();
    const filter = fromPackageJson({ singleton: true }, ROOT).filter(['chalk']).get();

    expect(only).toEqual(filter);
    expect(keys(only)).toContain('chalk');
    expect(keys(only)).not.toContain('tinyglobby');
  });

  it('unions with filter()', () => {
    const mixed = fromPackageJson({ singleton: true }, ROOT).only(['chalk']).filter(['tinyglobby']);
    const both = fromPackageJson({ singleton: true }, ROOT).filter(['chalk', 'tinyglobby']);

    expect(keys(mixed.get())).toEqual(keys(both.get()));
    expect(keys(mixed.get())).toEqual(expect.arrayContaining(['chalk', 'tinyglobby']));
  });
});

// core#251: a relative projectPath is read against workspaceRoot, not the working directory.
describe('a relative projectPath', () => {
  const WS = path.resolve('/ws');

  afterEach(() => {
    useWorkspace('');
    vi.restoreAllMocks();
  });

  it('reads the package.json under the workspace root', () => {
    const io = createMemoryIo()
      .setFile(
        path.join(WS, 'apps/shell/package.json'),
        JSON.stringify({ dependencies: { mylib: '^1.2.3' } })
      )
      .setFile(
        path.resolve('apps/shell/package.json'),
        JSON.stringify({ dependencies: { wrong: '1' } })
      );
    useWorkspace(WS, io);

    const result = shareAllCore(
      io,
      { singleton: true, includeSecondaries: false },
      { projectPath: 'apps/shell' },
      createPackageJsonRepository(io)
    );

    expect(Object.keys(result!)).toEqual(['mylib']);
  });

  // Unresolved, the walk from '..' went '../' → './' and found cwd's node_modules, which is not
  // an ancestor of the start.
  it('walks the real parents of a start above cwd when no workspace root is set', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    const io = createMemoryIo()
      .setFile(path.resolve('../package.json'), '{}')
      .setFile(path.resolve('node_modules/react/package.json'), '{}');

    const result = shareCore(
      io,
      { react: { singleton: true, requiredVersion: '^19.0.0' } },
      '..',
      [],
      createPackageJsonRepository(io)
    );

    expect(Object.keys(result)).toEqual(['react']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not find react'));
  });
});

describe('fromPackageJson() without a base config', () => {
  const ROOT = process.cwd();

  it('shares every dependency as a strict singleton built per package', () => {
    const shared = fromPackageJson(undefined, ROOT).only(['chalk']).get();

    expect(shared['chalk']).toMatchObject({
      singleton: true,
      strictVersion: true,
      build: 'package',
    });
    expect(shared['chalk']!.requiredVersion).not.toBe('auto');
  });

  // A passed base replaces the default; it is not merged into it.
  it('uses a passed base as is', () => {
    const shared = fromPackageJson({ singleton: true }, ROOT).only(['chalk']).get();

    expect(shared['chalk']!.strictVersion).toBeUndefined();
    expect(shared['chalk']!.build).toBeUndefined();
  });
});

// The orchestrator cannot parse a protocol value or a dist-tag, so these publish a range on the
// installed version instead.
describe('a declared value that is not a semver range', () => {
  const PROJECT = path.resolve('/ws/app');

  const workspace = (dependencies: Record<string, string>, installed: Record<string, object>) => {
    const io = createMemoryIo().setFile(
      path.join(PROJECT, 'package.json'),
      JSON.stringify({ dependencies })
    );
    for (const [name, pkg] of Object.entries(installed)) {
      io.setFile(path.join(PROJECT, 'node_modules', name, 'package.json'), JSON.stringify(pkg));
    }
    return { io, repo: createPackageJsonRepository(io) };
  };

  const viaShareAll = (
    dependencies: Record<string, string>,
    installed: Record<string, object>,
    requiredVersion?: ShareAllExternalsOptions['requiredVersion']
  ) => {
    const { io, repo } = workspace(dependencies, installed);
    return shareAllCore(
      io,
      { singleton: true, includeSecondaries: false, requiredVersion },
      { projectPath: PROJECT },
      repo
    )!;
  };

  it.each(['catalog:', 'workspace:^1.2.0', 'npm:other@^1.0.0', 'file:../lib', 'latest'])(
    'publishes ~ on the installed version, floored, for %s through shareAll',
    declared => {
      const result = viaShareAll({ mylib: declared }, { mylib: { version: '17.3.5' } });

      expect(result['mylib']!.requiredVersion).toBe('~17.3.0');
      expect(semver.satisfies('17.3.5', result['mylib']!.requiredVersion!)).toBe(true);
    }
  );

  // ~18.0.0 would not admit 18.0.0-rc.1 itself, nor another copy at rc.2.
  it('keeps the tag of an installed prerelease', () => {
    const result = viaShareAll({ mylib: 'catalog:' }, { mylib: { version: '18.0.0-rc.1' } });

    expect(result['mylib']!.requiredVersion).toBe('~18.0.0-rc.1');
    expect(semver.satisfies('18.0.0-rc.1', result['mylib']!.requiredVersion!)).toBe(true);
  });

  it('publishes ~ on the installed version, floored, through share', () => {
    const { io, repo } = workspace({ mylib: 'catalog:' }, { mylib: { version: '17.3.5' } });

    const result = shareCore(
      io,
      { mylib: { singleton: true, requiredVersion: 'auto', includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(result['mylib']!.requiredVersion).toBe('~17.3.0');
  });

  it('applies { range } to the installed version, without the floor', () => {
    const shareAllResult = viaShareAll(
      { mylib: 'workspace:^1.2.0' },
      { mylib: { version: '1.4.2' } },
      { range: '^' }
    );
    const { io, repo } = workspace({ mylib: 'workspace:^1.2.0' }, { mylib: { version: '1.4.2' } });
    const shareResult = shareCore(
      io,
      { mylib: { requiredVersion: { range: '^' }, includeSecondaries: false } },
      PROJECT,
      DEFAULT_SKIP_LIST,
      repo
    );

    expect(shareAllResult['mylib']!.requiredVersion).toBe('^1.4.2');
    expect(shareResult['mylib']!.requiredVersion).toBe('^1.4.2');
  });

  it('copies a semver range unchanged', () => {
    const result = viaShareAll({ mylib: '^17.0.0' }, { mylib: { version: '17.3.5' } });

    expect(result['mylib']!.requiredVersion).toBe('^17.0.0');
  });

  it.each([
    ['nothing is installed', {}],
    // common for a workspace:* link
    ['the installed package.json has no version', { mylib: { name: 'mylib' } }],
  ])('keeps the declared value when %s', (_label, installed) => {
    const result = viaShareAll({ mylib: 'workspace:*' }, installed);

    expect(result['mylib']!.requiredVersion).toBe('workspace:*');
  });

  it('applies { range } to an explicit version instead of the installed one', () => {
    const result = viaShareAll(
      { mylib: 'catalog:' },
      { mylib: { version: '17.3.5' } },
      { range: '^', version: '2.0.0' }
    );

    expect(result['mylib']!.requiredVersion).toBe('^2.0.0');
  });

  it('leaves a requiredVersion the user wrote untouched', () => {
    const result = viaShareAll({ mylib: 'catalog:' }, { mylib: { version: '17.3.5' } }, '^17.1.0');

    expect(result['mylib']!.requiredVersion).toBe('^17.1.0');
  });
});
