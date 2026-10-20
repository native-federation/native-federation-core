import { describe, expect, it } from 'vitest';
import {
  createBuildResultMap,
  lookupInResultMap,
  popFromResultMap,
} from './build-result-map.js';

const r = (fileName: string) => ({ fileName }) as never;

describe('createBuildResultMap', () => {
  it('maps by basename when not hashed', () => {
    const map = createBuildResultMap([r('dist/main.js'), r('dist/dep.js')], false);
    expect(map).toEqual({ 'main.js': 'dist/main.js', 'dep.js': 'dist/dep.js' });
  });

  it('strips the hash when the de-hashed name is expected', () => {
    const map = createBuildResultMap([r('dist/main-AB12CD.js')], true, ['main.js']);
    expect(map).toEqual({ 'main.js': 'dist/main-AB12CD.js' });
  });

  // Mapping output names can carry a '-2' suffix (claimUniqueName); only the last '-' is the hash.
  it('strips only the hash from a suffixed name', () => {
    const map = createBuildResultMap(
      [r('dist/_org_ui_table-AB12CD.js'), r('dist/_org_ui_table-2-EF34GH.js')],
      true,
      ['_org_ui_table.js', '_org_ui_table-2.js']
    );
    expect(map).toEqual({
      '_org_ui_table.js': 'dist/_org_ui_table-AB12CD.js',
      '_org_ui_table-2.js': 'dist/_org_ui_table-2-EF34GH.js',
    });
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

describe('lookupInResultMap', () => {
  it('returns the basename of the mapped file', () => {
    const map = { 'main.js': 'dist/assets/main-XYZ.js' };
    expect(lookupInResultMap(map, 'whatever/main.js')).toBe('main-XYZ.js');
  });

  it('throws a descriptive error for a missing key', () => {
    expect(() => lookupInResultMap({}, 'missing.js')).toThrow(/No build result found for 'missing.js'/);
  });
});

describe('popFromResultMap', () => {
  it('returns the full mapped path and removes the entry', () => {
    const map = { 'main.js': 'dist/main.js' };
    expect(popFromResultMap(map, 'main.js')).toBe('dist/main.js');
    expect(map).toEqual({});
  });

  it('throws a descriptive error for a missing key', () => {
    expect(() => popFromResultMap({}, 'missing.js')).toThrow(/No build result found for 'missing.js'/);
  });
});
