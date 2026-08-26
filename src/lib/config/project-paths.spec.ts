import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { cwd } from 'process';
import { findRootTsConfigJsonCore } from './project-paths.js';
import { createMemoryIo } from '../utils/io/__test-helpers__/memory-io.js';

const ROOT = cwd();

describe('findRootTsConfigJsonCore', () => {
  const withPackageJson = () => createMemoryIo().setFile(path.join(ROOT, 'package.json'), '{}');

  it('prefers tsconfig.base.json when both exist', () => {
    const io = withPackageJson()
      .setFile(path.join(ROOT, 'tsconfig.base.json'), '{}')
      .setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.base.json'));
  });

  it('falls back to tsconfig.json when no base config exists', () => {
    const io = withPackageJson().setFile(path.join(ROOT, 'tsconfig.json'), '{}');
    expect(findRootTsConfigJsonCore(io)).toBe(path.join(ROOT, 'tsconfig.json'));
  });

  it('throws when neither config is present', () => {
    expect(() => findRootTsConfigJsonCore(withPackageJson())).toThrow(/Neither a tsconfig/);
  });

  // The mirror image of the Nx case bug: cwd() is the mis-cased side. The returned path
  // seeds every sharedMappings key, so it has to agree with the workspace root.
  it('returns the on-disk spelling when cwd() is mis-cased', () => {
    const disk = path.join(path.dirname(ROOT), path.basename(ROOT).toUpperCase());
    const io = createMemoryIo()
      .setDiskCase(ROOT, disk)
      .setFile(path.join(disk, 'package.json'), '{}')
      .setFile(path.join(disk, 'tsconfig.base.json'), '{}');

    expect(findRootTsConfigJsonCore(io)).toBe(path.join(disk, 'tsconfig.base.json'));
  });
});
