import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getRawMappedPathsCore } from './mapped-paths.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import type {
  SharedMappingConfigs,
  SharedMappingEntry,
} from '../domain/config/federation-config.contract.js';
import {
  mappingsFromWorkspace,
  normalizeMappingConfig,
  resolveMappingConfig,
} from './mapping-utils.js';

const ROOT = path.resolve('/ws');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');

const writeTsConfig = (paths: Record<string, string[]> | undefined) =>
  createMemoryIo().setFile(
    TSCONFIG,
    JSON.stringify(paths ? { compilerOptions: { paths } } : { compilerOptions: {} })
  );

describe('getRawMappedPathsCore', () => {
  it('throws when the tsconfig path is not absolute', () => {
    expect(() => getRawMappedPathsCore(createMemoryIo(), 'tsconfig.json')).toThrow(/absolute path/);
  });

  it('returns an empty map when there are no compilerOptions.paths', () => {
    expect(getRawMappedPathsCore(writeTsConfig(undefined), TSCONFIG).paths).toEqual({});
  });

  it('throws on a tsconfig that is not valid JSONC', () => {
    const io = createMemoryIo().setFile(TSCONFIG, '{ "compilerOptions": { "paths": ');
    expect(() => getRawMappedPathsCore(io, TSCONFIG)).toThrow(/Could not parse .*tsconfig\.json/);
  });

  it('parses JSONC (comments / trailing commas)', () => {
    const io = createMemoryIo().setFile(
      TSCONFIG,
      `{
        // a comment
        "compilerOptions": { "paths": { "@lib": ["libs/lib/src/index.ts"], } }
      }`
    );
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG);
    expect(result).toEqual({ [path.join(ROOT, 'libs/lib/src/index.ts')]: '@lib' });
  });

  it('shares all mappings when none are explicitly configured', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'], '@b': ['b/index.ts'] });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG);
    expect(Object.values(result).sort()).toEqual(['@a', '@b']);
  });

  it('shares only the configured subset when provided', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'], '@b': ['b/index.ts'] });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG, ['@a']);
    expect(Object.values(result)).toEqual(['@a']);
  });

  // Declarations are checked against every key, not against what this remote selects; a key
  // without a target still counts.
  it('returns every key, whatever the selection', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'], '@b/*': ['b/*'], '@c': [] });
    expect(getRawMappedPathsCore(io, TSCONFIG, ['@a']).keys).toEqual(['@a', '@b/*', '@c']);
    expect(getRawMappedPathsCore(io, TSCONFIG).keys).toEqual(['@a', '@b/*', '@c']);
  });

  // A declaration names a package; it selects nothing, so `@b` stays unshared.
  it('collects { package } entries with their config, without selecting them', () => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'], '@b': ['b/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG, [
      { package: '@a/x', singleton: false },
      '@a/x',
    ]);
    expect(result.packages).toEqual({ '@a/x': { singleton: false } });
    expect(Object.values(result.paths)).toEqual(['@a/x']);
    expect(result.configs).toEqual({});
  });

  // Only an absent sharedMappings shares everything; declarations never count as a selection.
  it.each([
    ['only declarations', [{ package: '@a/x' }]],
    ['an empty list', []],
  ])('selects nothing from %s', (_label, entries) => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'], '@b': ['b/index.ts'] });
    expect(getRawMappedPathsCore(io, TSCONFIG, entries).paths).toEqual({});
  });

  it('accepts a repeated declaration with the same config', () => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'] });
    const entries = [
      { package: '@a/x', pool: 'a' },
      { package: '@a/x', pool: 'a' },
    ];
    expect(getRawMappedPathsCore(io, TSCONFIG, entries).packages).toEqual({
      '@a/x': { pool: 'a' },
    });
  });

  it('rejects a repeated declaration with another config', () => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'] });
    const entries = [
      { package: '@a/x', pool: 'a' },
      { package: '@a/x', pool: 'b' },
    ];
    expect(() => getRawMappedPathsCore(io, TSCONFIG, entries)).toThrow(
      `Shared mapping package '@a/x' is declared twice with different configs (pool: "a" vs "b").`
    );
  });

  // Untyped configs can hand over anything.
  it.each([[{}], [{ package: 1 }], [null]])('rejects the malformed entry %j', entry => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'] });
    const entries = [entry] as unknown as SharedMappingEntry[];
    expect(() => getRawMappedPathsCore(io, TSCONFIG, entries)).toThrow(
      `Invalid sharedMappings entry ${JSON.stringify(entry)}`
    );
  });

  // Builder output through selection and lookup: the package config reaches every entry point,
  // while a sibling that only shares the prefix's characters keeps its own.
  it('resolves every import under a declared package to its config', () => {
    const io = writeTsConfig({
      '@org/lib': ['libs/lib/index.ts'],
      '@org/lib/testing': ['libs/lib/testing/index.ts'],
      '@org/library': ['libs/library/index.ts'],
    });
    const entries = mappingsFromWorkspace({ singleton: true })
      .patch(['@org/library'], { pool: 'patch' })
      .package('@org/lib', { pool: 'lib' })
      .get();

    const { paths, configs, packages } = getRawMappedPathsCore(io, TSCONFIG, entries);
    const normalized = (c: SharedMappingConfigs) =>
      Object.fromEntries(Object.entries(c).map(([k, v]) => [k, normalizeMappingConfig(v, true)]));
    const pool = (importName: string) =>
      resolveMappingConfig(importName, normalized(configs), true, normalized(packages)).pool;

    expect(Object.values(paths).sort()).toEqual(['@org/lib', '@org/lib/testing', '@org/library']);
    expect(['@org/lib', '@org/lib/testing', '@org/library'].map(pool)).toEqual([
      'lib',
      'lib',
      'patch',
    ]);
  });

  it('rejects a build on a declaration', () => {
    const io = writeTsConfig({ '@a/x': ['a/x.ts'] });
    const entries = [{ package: '@a/x', build: 'separate' }] as unknown as SharedMappingEntry[];
    expect(() => getRawMappedPathsCore(io, TSCONFIG, entries)).toThrow(
      "Shared mapping package '@a/x' sets build"
    );
  });

  it('returns no keys without compilerOptions.paths', () => {
    expect(getRawMappedPathsCore(writeTsConfig(undefined), TSCONFIG).keys).toEqual([]);
  });

  it('selects every key matching a wildcard pattern', () => {
    const io = writeTsConfig({
      '@org/ui': ['libs/ui/index.ts'],
      '@org/auth': ['libs/auth/index.ts'],
      '@other/x': ['libs/x/index.ts'],
    });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG, ['@org/*']);
    expect(Object.values(result).sort()).toEqual(['@org/auth', '@org/ui']);
  });

  // A tsconfig key may itself contain the wildcard; the pattern has to match it verbatim too.
  it('selects a wildcard tsconfig key', () => {
    const io = writeTsConfig({
      '@org/ui/*': ['libs/ui/*/index.ts'],
      '@org/auth': ['libs/auth/index.ts'],
    });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG, ['@org/ui/*']);
    expect(Object.values(result)).toEqual(['@org/ui/*']);
  });

  it('does not let an exact pattern match a wildcard key', () => {
    const io = writeTsConfig({ '@org/ui/*': ['libs/ui/*/index.ts'] });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG, ['@org/ui']);
    expect(result).toEqual({});
  });

  it('accepts a mix of plain keys and annotated tuples', () => {
    const io = writeTsConfig({
      '@org/a': ['libs/a/index.ts'],
      '@org/b': ['libs/b/index.ts'],
      '@org/c': ['libs/c/index.ts'],
    });
    const result = getRawMappedPathsCore(io, TSCONFIG, [
      '@org/a',
      [['@org/b'], { singleton: false }],
    ]);

    expect(Object.values(result.paths).sort()).toEqual(['@org/a', '@org/b']);
    expect(result.configs).toEqual({ '@org/b': { singleton: false } });
  });

  it('spreads one config across every key of its tuple', () => {
    const io = writeTsConfig({ '@org/a': ['libs/a/index.ts'], '@org/b': ['libs/b/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG, [
      [['@org/a', '@org/b'], { requiredVersion: '^1.0.0' }],
    ]);

    expect(result.configs).toEqual({
      '@org/a': { requiredVersion: '^1.0.0' },
      '@org/b': { requiredVersion: '^1.0.0' },
    });
  });

  // First-match-wins is the resolution rule downstream; declaration order has to survive here.
  it('keeps the first config declared for a repeated pattern', () => {
    const io = writeTsConfig({ '@org/a': ['libs/a/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG, [
      [['@org/a'], { singleton: true }],
      [['@org/a'], { singleton: false }],
    ]);

    expect(result.configs).toEqual({ '@org/a': { singleton: true } });
  });

  it('uses the first path entry of each mapping', () => {
    const io = writeTsConfig({ '@a': ['a/first.ts', 'a/second.ts'] });
    const { paths: result } = getRawMappedPathsCore(io, TSCONFIG);
    expect(result).toEqual({ [path.join(ROOT, 'a/first.ts')]: '@a' });
  });

  it('resolves paths relative to an explicit rootPath when given', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'] });
    const { paths: result } = getRawMappedPathsCore(
      io,
      TSCONFIG,
      undefined,
      path.resolve('/other')
    );
    expect(result).toEqual({ [path.join(path.resolve('/other'), 'a/index.ts')]: '@a' });
  });

  // core#149: the compile follows `extends`, so the mapping set has to as well.
  describe('resolves paths the way TypeScript does', () => {
    it('follows extends to a parent tsconfig and resolves against the file defining paths', () => {
      const io = createMemoryIo()
        .setFile(
          path.join(ROOT, 'tsconfig.base.json'),
          JSON.stringify({ compilerOptions: { paths: { '@org/ui': ['libs/ui/index.ts'] } } })
        )
        .setFile(
          path.join(ROOT, 'apps/shell/tsconfig.federation.json'),
          JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src/**/*.d.ts'] })
        );

      const { paths: result } = getRawMappedPathsCore(
        io,
        path.join(ROOT, 'apps/shell/tsconfig.federation.json')
      );
      expect(result).toEqual({ [path.join(ROOT, 'libs/ui/index.ts')]: '@org/ui' });
    });

    it('lets a child override the paths it inherits', () => {
      const io = createMemoryIo()
        .setFile(
          path.join(ROOT, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { paths: { '@org/ui': ['libs/ui/index.ts'] } } })
        )
        .setFile(
          path.join(ROOT, 'apps/shell/tsconfig.app.json'),
          JSON.stringify({
            extends: '../../tsconfig.json',
            compilerOptions: { paths: { '@shell/data': ['src/data/index.ts'] } },
          })
        );

      const { paths: result } = getRawMappedPathsCore(
        io,
        path.join(ROOT, 'apps/shell/tsconfig.app.json')
      );
      expect(result).toEqual({ [path.join(ROOT, 'apps/shell/src/data/index.ts')]: '@shell/data' });
    });

    it('follows extends into a package', () => {
      const io = createMemoryIo()
        .setFile(path.join(ROOT, 'package.json'), '{}')
        .setFile(
          path.join(ROOT, 'node_modules/@org/tsconfig/package.json'),
          JSON.stringify({ name: '@org/tsconfig', version: '1.0.0' })
        )
        .setFile(
          path.join(ROOT, 'node_modules/@org/tsconfig/tsconfig.json'),
          JSON.stringify({
            compilerOptions: { baseUrl: '../../..', paths: { '@org/ui': ['libs/ui/index.ts'] } },
          })
        )
        .setFile(TSCONFIG, JSON.stringify({ extends: '@org/tsconfig/tsconfig.json' }));

      const { paths: result } = getRawMappedPathsCore(io, TSCONFIG);
      expect(result).toEqual({ [path.join(ROOT, 'libs/ui/index.ts')]: '@org/ui' });
    });

    it('resolves targets against baseUrl', () => {
      const io = createMemoryIo().setFile(
        TSCONFIG,
        JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '@a': ['a/index.ts'] } } })
      );
      const { paths: result } = getRawMappedPathsCore(io, TSCONFIG);
      expect(result).toEqual({ [path.join(ROOT, 'src/a/index.ts')]: '@a' });
    });

    // A missing extends target is only a diagnostic to TypeScript; swallowed, the inherited
    // paths would vanish and every remote would bundle its own copy of the workspace libs.
    it('throws when a relative extends target does not exist', () => {
      const io = createMemoryIo().setFile(
        TSCONFIG,
        JSON.stringify({ extends: './tsconfig.bse.json', compilerOptions: {} })
      );
      expect(() => getRawMappedPathsCore(io, TSCONFIG)).toThrow(
        /Could not resolve the extends chain of .*tsconfig\.json.*tsconfig\.bse\.json/
      );
    });

    it('throws when an extended package is not installed', () => {
      const io = createMemoryIo()
        .setFile(path.join(ROOT, 'package.json'), '{}')
        .setFile(TSCONFIG, JSON.stringify({ extends: '@org/tsconfig/tsconfig.json' }));
      expect(() => getRawMappedPathsCore(io, TSCONFIG)).toThrow(
        /Could not resolve the extends chain.*@org\/tsconfig\/tsconfig\.json/
      );
    });

    // TypeScript accepts this when parsing and reports TS5066 at compile time.
    it('skips a key with an empty target list', () => {
      const io = writeTsConfig({ '@empty': [], '@a': ['a/index.ts'] });
      expect(Object.values(getRawMappedPathsCore(io, TSCONFIG).paths)).toEqual(['@a']);
    });

    // TS 6 reports a deprecated baseUrl as an error; that is the compile's to raise, not ours.
    it('does not throw on option diagnostics', () => {
      const io = createMemoryIo().setFile(
        TSCONFIG,
        JSON.stringify({ compilerOptions: { notAnOption: true, paths: { '@a': ['a/index.ts'] } } })
      );
      expect(Object.values(getRawMappedPathsCore(io, TSCONFIG).paths)).toEqual(['@a']);
    });
  });
});
