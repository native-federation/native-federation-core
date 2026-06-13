import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { resolvePackageJsonExportsWildcardCore } from './resolve-wildcard-keys.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

const CWD = path.resolve('/pkg');

describe('resolvePackageJsonExportsWildcardCore', () => {
  it('returns an empty array when the value pattern has no wildcard', () => {
    const io = createMemoryIo().setFile(path.join(CWD, 'src/a.js'), '');
    expect(resolvePackageJsonExportsWildcardCore(io, './a', './src/a.js', CWD)).toEqual([]);
  });

  it('expands a wildcard across nested directories and substitutes the key', () => {
    const io = createMemoryIo()
      .setFile(path.join(CWD, 'src/features/a.js'), '')
      .setFile(path.join(CWD, 'src/features/nested/b.js'), '')
      .setFile(path.join(CWD, 'src/features/c.d.ts'), ''); // wrong suffix, excluded

    const result = resolvePackageJsonExportsWildcardCore(
      io,
      './features/*',
      './src/features/*.js',
      CWD
    );

    expect(result).toEqual([
      { key: './features/a', value: 'src/features/a.js' },
      { key: './features/nested/b', value: 'src/features/nested/b.js' },
    ]);
  });

  it('strips a leading "./" from the value pattern before globbing', () => {
    const io = createMemoryIo().setFile(path.join(CWD, 'lib/x.mjs'), '');
    const result = resolvePackageJsonExportsWildcardCore(io, './*', './lib/*.mjs', CWD);
    expect(result).toEqual([{ key: './x', value: 'lib/x.mjs' }]);
  });
});
