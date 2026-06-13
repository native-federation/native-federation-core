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
    expect(() => getRawMappedPathsCore(createMemoryIo(), 'tsconfig.json')).toThrow(
      /absolute path/
    );
  });

  it('returns an empty map when there are no compilerOptions.paths', () => {
    expect(getRawMappedPathsCore(writeTsConfig(undefined), TSCONFIG)).toEqual({});
  });

  it('parses JSON5 (comments / trailing commas)', () => {
    const io = createMemoryIo().setFile(
      TSCONFIG,
      `{
        // a comment
        "compilerOptions": { "paths": { "@lib": ["libs/lib/src/index.ts"], } }
      }`
    );
    const result = getRawMappedPathsCore(io, TSCONFIG);
    expect(result).toEqual({ [path.join(ROOT, 'libs/lib/src/index.ts')]: '@lib' });
  });

  it('shares all mappings when none are explicitly configured', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'], '@b': ['b/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG);
    expect(Object.values(result).sort()).toEqual(['@a', '@b']);
  });

  it('shares only the configured subset when provided', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'], '@b': ['b/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG, ['@a']);
    expect(Object.values(result)).toEqual(['@a']);
  });

  it('uses the first path entry of each mapping', () => {
    const io = writeTsConfig({ '@a': ['a/first.ts', 'a/second.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG);
    expect(result).toEqual({ [path.join(ROOT, 'a/first.ts')]: '@a' });
  });

  it('resolves paths relative to an explicit rootPath when given', () => {
    const io = writeTsConfig({ '@a': ['a/index.ts'] });
    const result = getRawMappedPathsCore(io, TSCONFIG, undefined, path.resolve('/other'));
    expect(result).toEqual({ [path.join(path.resolve('/other'), 'a/index.ts')]: '@a' });
  });
});
