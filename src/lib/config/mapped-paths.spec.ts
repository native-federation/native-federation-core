import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getRawMappedPathsCore } from './mapped-paths.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

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

  it('parses JSON5 (comments / trailing commas)', () => {
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
});
