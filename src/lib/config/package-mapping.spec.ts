import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { createMemoryIo, type MemoryIo } from '../utils/io/__test-helpers__/memory-io.js';
import {
  createPackageMappingPredicate,
  isPackageMapping,
  resolvePackageMappingEntry,
} from './package-mapping.js';

const ROOT = path.resolve('/ws');
const PKG = path.join(ROOT, 'dist/ui');

/** The shape ng-packagr writes: fesm bundle + rolled-up types, both named in `exports`. */
const builtPackage = (manifest: unknown): MemoryIo =>
  createMemoryIo()
    .setDir(PKG)
    .setFile(path.join(PKG, 'package.json'), JSON.stringify(manifest))
    .setFile(path.join(PKG, 'fesm2022/ui.mjs'), '')
    .setFile(path.join(PKG, 'types/ui.d.ts'), '');

const ngPackagrManifest = {
  name: 'ui',
  version: '0.0.1',
  type: 'module',
  module: 'fesm2022/ui.mjs',
  typings: 'types/ui.d.ts',
  exports: {
    './package.json': { default: './package.json' },
    '.': { types: './types/ui.d.ts', default: './fesm2022/ui.mjs' },
  },
};

describe('isPackageMapping', () => {
  it('accepts a directory carrying a package.json', () => {
    expect(isPackageMapping(builtPackage(ngPackagrManifest), PKG)).toBe(true);
  });

  it('rejects a source barrel', () => {
    const file = path.join(ROOT, 'libs/ui/src/public-api.ts');
    expect(isPackageMapping(createMemoryIo().setFile(file, ''), file)).toBe(false);
  });

  it('rejects a directory without a package.json', () => {
    const dir = path.join(ROOT, 'libs/ui/src');
    expect(isPackageMapping(createMemoryIo().setDir(dir), dir)).toBe(false);
  });
});

describe('createPackageMappingPredicate', () => {
  it('answers the same as isPackageMapping, and only reads disk once per path', () => {
    const io = builtPackage(ngPackagrManifest);
    let reads = 0;
    const counting = { ...io, isDirectory: (p: string) => (reads++, io.isDirectory(p)) };

    const isPackage = createPackageMappingPredicate(counting);
    expect([isPackage(PKG), isPackage(PKG), isPackage(PKG)]).toEqual([true, true, true]);
    expect(reads).toBe(1);
  });
});

describe('resolvePackageMappingEntry', () => {
  it("prefers the ESM target of the '.' export over the types condition", () => {
    expect(resolvePackageMappingEntry(builtPackage(ngPackagrManifest), PKG)).toBe(
      path.join(PKG, 'fesm2022/ui.mjs')
    );
  });

  it("falls back to 'module' when there is no exports field", () => {
    const io = builtPackage({ name: 'ui', module: 'fesm2022/ui.mjs' });
    expect(resolvePackageMappingEntry(io, PKG)).toBe(path.join(PKG, 'fesm2022/ui.mjs'));
  });

  it("falls back to 'main' when 'module' is absent", () => {
    const io = builtPackage({ name: 'ui', main: 'fesm2022/ui.mjs' });
    expect(resolvePackageMappingEntry(io, PKG)).toBe(path.join(PKG, 'fesm2022/ui.mjs'));
  });

  it('returns null when the manifest names a file that is not on disk', () => {
    const io = builtPackage({ name: 'ui', module: 'fesm2022/missing.mjs' });
    expect(resolvePackageMappingEntry(io, PKG)).toBeNull();
  });

  it('returns null when there is no manifest at all', () => {
    expect(resolvePackageMappingEntry(createMemoryIo().setDir(PKG), PKG)).toBeNull();
  });

  it('warns rather than throwing on an unparseable manifest', () => {
    const io = createMemoryIo()
      .setDir(PKG)
      .setFile(path.join(PKG, 'package.json'), '{ not json');
    expect(resolvePackageMappingEntry(io, PKG)).toBeNull();
  });
});
