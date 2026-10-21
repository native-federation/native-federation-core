import { describe, expect, it } from 'vitest';
import { createBuildResultMap, lookupInResultMap, popFromResultMap } from './build-result-map.js';

const r = (fileName: string, entry?: string) => ({ fileName, ...(entry && { entry }) }) as never;

describe('createBuildResultMap', () => {
  it('maps by basename when not hashed', () => {
    const map = createBuildResultMap([r('dist/main.js'), r('dist/dep.js')], false);
    expect(map).toEqual({ 'main.js': 'dist/main.js', 'dep.js': 'dist/dep.js' });
  });

  it('finds a hashed entry by its expected name', () => {
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

  // Rollup 4 and Rolldown write url-safe base64 hashes, which can contain '-'.
  it('finds an entry whose hash contains a dash', () => {
    const map = createBuildResultMap([r('/d/Rel-_z3-emEa.js')], true, ['Rel.js']);
    expect(map).toEqual({ 'Rel.js': '/d/Rel-_z3-emEa.js' });
  });

  it('gives the longer stem its own file when one stem prefixes another', () => {
    const map = createBuildResultMap([r('/d/my-AAAA1111.js'), r('/d/my-comp-BBBB2222.js')], true, [
      'my.js',
      'my-comp.js',
    ]);
    expect(map).toEqual({ 'my.js': '/d/my-AAAA1111.js', 'my-comp.js': '/d/my-comp-BBBB2222.js' });
  });

  it('finds an entry with a dot and a dash in its own name', () => {
    const map = createBuildResultMap([r('/d/my.widget-v2-Ab-c1234.js')], true, ['my.widget-v2.js']);
    expect(map).toEqual({ 'my.widget-v2.js': '/d/my.widget-v2-Ab-c1234.js' });
  });

  it("never claims an entry's source map", () => {
    const map = createBuildResultMap([r('/d/a-AAAA1111.js'), r('/d/a-AAAA1111.js.map')], true, [
      'a.js',
    ]);
    expect(map).toEqual({
      'a.js': '/d/a-AAAA1111.js',
      'a-AAAA1111.js.map': '/d/a-AAAA1111.js.map',
    });
  });

  it('prefers an exact name over a hashed one', () => {
    const map = createBuildResultMap([r('/d/a-b.js'), r('/d/a.js')], true, ['a.js', 'a-b.js']);
    expect(map).toEqual({ 'a.js': '/d/a.js', 'a-b.js': '/d/a-b.js' });
  });

  // Dev builds are unhashed: a chunk named after an entry stays a chunk.
  it('only accepts an exact name when not hashed', () => {
    const map = createBuildResultMap([r('/d/Component.js'), r('/d/Component-shared-x.js')], false, [
      'Component.js',
    ]);
    expect(map).toEqual({
      'Component.js': '/d/Component.js',
      'Component-shared-x.js': '/d/Component-shared-x.js',
    });
  });

  // core#193: esbuild names chunks `chunk-<hash>`, so an exposed `./chunk` matches all of them.
  it('throws instead of guessing when several files match one entry', () => {
    expect(() =>
      createBuildResultMap(
        [r('/d/chunk-AAAA1111.js'), r('/d/chunk-BBBB2222.js'), r('/d/chunk-CCCC3333.js')],
        true,
        ['chunk.js']
      )
    ).toThrow(/entry point 'chunk' has the same name as other files.*set 'entry'/);
  });

  // Names alone cannot decide: `my`'s hash starts with `comp-`.
  it('throws when a longer stem matches two files', () => {
    expect(() =>
      createBuildResultMap([r('/d/my-comp-AAAA.js'), r('/d/my-comp-BBBB2222.js')], true, [
        'my.js',
        'my-comp.js',
      ])
    ).toThrow(/entry point 'my-comp'/);
  });
});

describe('createBuildResultMap with entry set by the adapter', () => {
  // `my-AAAA1111.js` would match 'my.js' by name, but once one result sets `entry` names are not read.
  it('reads entries from the field, never from the name', () => {
    const map = createBuildResultMap(
      [r('/d/chunk-AAAA1111.js', 'chunk.js'), r('/d/chunk-BBBB2222.js'), r('/d/my-AAAA1111.js')],
      true,
      ['chunk.js', 'my.js']
    );
    expect(map).toEqual({
      'chunk.js': '/d/chunk-AAAA1111.js',
      'chunk-BBBB2222.js': '/d/chunk-BBBB2222.js',
      'my-AAAA1111.js': '/d/my-AAAA1111.js',
    });
  });

  it('throws when two results name the same entry', () => {
    expect(() =>
      createBuildResultMap([r('/d/a-1.js', 'a.js'), r('/d/a-2.js', 'a.js')], true, ['a.js'])
    ).toThrow("both set entry 'a.js'");
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
