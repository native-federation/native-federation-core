import { describe, expect, it } from 'vitest';
import { createBuildResultMap, lookupInResultMap, popFromResultMap } from './build-result-map.js';

const r = (fileName: string, entry?: string) => ({ fileName, ...(entry && { entry }) }) as never;

describe('createBuildResultMap', () => {
  it('maps by basename when not hashed', () => {
    const map = createBuildResultMap([r('dist/main.js'), r('dist/dep.js')], false);
    expect(map).toEqual({ 'main.js': 'dist/main.js', 'dep.js': 'dist/dep.js' });
  });

  it('strips the hash when the de-hashed name is expected', () => {
    const map = createBuildResultMap([r('dist/main-AB12CD.js')], true, ['main.js']);
    expect(map).toEqual({ 'main.js': 'dist/main-AB12CD.js' });
  });

  it('keeps the hashed name when it is not in the expected list', () => {
    const map = createBuildResultMap([r('dist/chunk-AB12CD.js')], true, ['main.js']);
    expect(map).toEqual({ 'chunk-AB12CD.js': 'dist/chunk-AB12CD.js' });
  });

  it('does not strip hashes when isHashed is false even if expected', () => {
    const map = createBuildResultMap([r('dist/main-AB12CD.js')], false, ['main.js']);
    expect(map).toEqual({ 'main-AB12CD.js': 'dist/main-AB12CD.js' });
  });

  it('leaves names without a hash separator unchanged', () => {
    const map = createBuildResultMap([r('dist/main.js')], true, ['main.js']);
    expect(map).toEqual({ 'main.js': 'dist/main.js' });
  });
});

describe('createBuildResultMap with entry set by the adapter', () => {
  // core#193: by name, every esbuild `chunk-<hash>` file is read as the exposed './chunk'.
  it('finds entries by the field and leaves every other file under its own name', () => {
    const map = createBuildResultMap(
      [r('/d/chunk-AAAA1111.js', 'chunk.js'), r('/d/chunk-BBBB2222.js'), r('/d/my-CCCC3333.js')],
      true,
      ['chunk.js', 'my.js']
    );
    expect(map).toEqual({
      'chunk.js': '/d/chunk-AAAA1111.js',
      'chunk-BBBB2222.js': '/d/chunk-BBBB2222.js',
      'my-CCCC3333.js': '/d/my-CCCC3333.js',
    });
  });

  // esbuild sets the entry point on the CSS it extracts from an entry too: copied over as is, the
  // stylesheet would silently replace the script as the published entry.
  it('throws when two results set the same entry', () => {
    expect(() =>
      createBuildResultMap(
        [r('/d/Cmp-AAAA1111.js', 'Cmp.js'), r('/d/Cmp-BBBB2222.css', 'Cmp.js')],
        true,
        ['Cmp.js']
      )
    ).toThrow(
      "NFBuildAdapter.build returned two results for entry 'Cmp.js': '/d/Cmp-AAAA1111.js' and '/d/Cmp-BBBB2222.css'."
    );
  });

  // Rollup and Rolldown hashes can contain '-', which the name match cuts at.
  it('finds an entry whose hash contains a dash', () => {
    const map = createBuildResultMap([r('/d/Rel-_z3-emEa.js', 'Rel.js')], true, ['Rel.js']);
    expect(map).toEqual({ 'Rel.js': '/d/Rel-_z3-emEa.js' });
  });
});

describe('lookupInResultMap', () => {
  it('returns the basename of the mapped file', () => {
    const map = { 'main.js': 'dist/assets/main-XYZ.js' };
    expect(lookupInResultMap(map, 'whatever/main.js')).toBe('main-XYZ.js');
  });

  it('throws a descriptive error for a missing key', () => {
    expect(() => lookupInResultMap({}, 'missing.js')).toThrow(
      /No build result found for 'missing.js'/
    );
  });
});

describe('popFromResultMap', () => {
  it('returns the full mapped path and removes the entry', () => {
    const map = { 'main.js': 'dist/main.js' };
    expect(popFromResultMap(map, 'main.js')).toBe('dist/main.js');
    expect(map).toEqual({});
  });

  it('throws a descriptive error for a missing key', () => {
    expect(() => popFromResultMap({}, 'missing.js')).toThrow(
      /No build result found for 'missing.js'/
    );
  });
});
