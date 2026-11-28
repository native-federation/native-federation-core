import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { findOptimalExport, replaceGlob, resolveExportsEntry } from './exports-resolver.js';
import type { PackageInfo } from '../../domain/utils/package-json.contract.js';

const info: PackageInfo = { packageName: 'p', entryPoint: '/pkg', version: '1.0.0', esm: false };

describe('replaceGlob', () => {
  it('replaces the asterisk in string leaves', () => {
    expect(replaceGlob('./dist/*.js', 'sub')).toBe('./dist/sub.js');
  });

  it('replaces every asterisk in a string leaf', () => {
    expect(replaceGlob('./*/dist/*.js', 'sub')).toBe('./sub/dist/sub.js');
  });

  it('keeps an array target an array', () => {
    expect(replaceGlob(['./esm/*.js', './cjs/*.js'], 'a')).toEqual(['./esm/a.js', './cjs/a.js']);
  });

  it('recurses into condition objects', () => {
    expect(replaceGlob({ import: './esm/*.js', require: './cjs/*.js' }, 'a')).toEqual({
      import: './esm/a.js',
      require: './cjs/a.js',
    });
  });
});

describe('findOptimalExport', () => {
  it('joins a string target onto the entry point', () => {
    const result = findOptimalExport('./index.js', info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './index.js'));
  });

  it('prefers an ESM condition and marks the result esm', () => {
    const result = findOptimalExport({ require: './cjs.js', import: './esm.js' }, info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './esm.js'));
    expect(result?.esm).toBe(true);
  });

  it('falls back to default, ignoring types', () => {
    const result = findOptimalExport({ types: './t.d.ts', default: './d.js' }, info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './d.js'));
  });

  it('falls back to the first non-types key without an ESM key or default', () => {
    const result = findOptimalExport(
      { types: './t.d.ts', node: './n.js', browser: './b.js' },
      info
    );
    expect(result?.entryPoint).toBe(path.join('/pkg', './n.js'));
  });

  it('prefers default over a platform key listed before it', () => {
    const result = findOptimalExport({ node: './n.js', default: './d.js' }, info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './d.js'));
  });

  it('takes the first non-types key when it names no platform', () => {
    const result = findOptimalExport({ types: './t.d.ts', worker: './w.js', node: './n.js' }, info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './w.js'));
  });

  it('applies the same order inside a nested ESM condition', () => {
    const result = findOptimalExport(
      { require: './c.js', import: { types: './t.d.ts', default: './esm.js' } },
      info
    );
    expect(result).toMatchObject({ entryPoint: path.join('/pkg', './esm.js'), esm: true });
  });

  it('resolves the first element of an array target', () => {
    const result = findOptimalExport(['./first.js', './second.js'], info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './first.js'));
  });
});

describe('findOptimalExport with an array target', () => {
  it.each([
    ['a bare specifier', 'other-pkg/index.js'],
    ['an absolute path', '/abs/index.js'],
    ['a parent segment', './dist/../../index.js'],
    ['a node_modules segment', './node_modules/dep/index.js'],
    ['a node_modules segment in another case', './NODE_MODULES/dep/index.js'],
    ['a . segment', './dist/./index.js'],
    ['a parent segment after a backslash', './dist\\..\\..\\index.js'],
    ['a URL', 'https://example.com/index.js'],
  ])('skips %s to the next valid target', (_, invalid) => {
    const result = findOptimalExport([invalid, './valid.js'], info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './valid.js'));
  });

  it('skips a conditions object that resolves nothing', () => {
    const result = findOptimalExport([{ types: './t.d.ts' }, './valid.js'], info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './valid.js'));
  });

  it('resolves nothing when no element is a valid target', () => {
    expect(findOptimalExport(['../outside.js'], info)).toBeUndefined();
    expect(findOptimalExport([], info)).toBeUndefined();
  });
});

describe('resolveExportsEntry', () => {
  it('matches an exact subpath key', () => {
    expect(resolveExportsEntry({ './sub': './dist/sub.js' }, './sub')).toBe('./dist/sub.js');
  });

  it('expands a trailing-asterisk subpath pattern', () => {
    expect(resolveExportsEntry({ './*': './dist/*.js' }, './feature')).toBe('./dist/feature.js');
  });

  it('matches an exact key listed before a pattern', () => {
    expect(resolveExportsEntry({ './sub': './sub.js', './*': './dist/*.js' }, './sub')).toBe(
      './sub.js'
    );
  });

  it('expands a pattern into every condition of its target', () => {
    expect(
      resolveExportsEntry(
        { './features/*': { import: './esm/*.js', default: './cjs/*.js' } },
        './features/a'
      )
    ).toEqual({ import: './esm/a.js', default: './cjs/a.js' });
  });

  it('prefers an exact key over a pattern listed before it', () => {
    expect(resolveExportsEntry({ './*': './dist/*.js', './sub': './sub.js' }, './sub')).toBe(
      './sub.js'
    );
  });

  it('prefers the pattern with the longest text before the asterisk', () => {
    const exports = { './a/*': './a/*.js', './a/b/*': './ab/*.js' };
    expect(resolveExportsEntry(exports, './a/b/c')).toBe('./ab/c.js');
    expect(resolveExportsEntry(exports, './a/c')).toBe('./a/c.js');
  });

  it('breaks a tie on the text before the asterisk with the longer key', () => {
    const exports = { './a/*': './raw/*', './a/*.js': './dist/*.mjs' };
    expect(resolveExportsEntry(exports, './a/x.js')).toBe('./dist/x.mjs');
    expect(resolveExportsEntry(exports, './a/x.css')).toBe('./raw/x.css');
  });

  it('matches the text after the asterisk as a suffix', () => {
    const exports = { './*.js': './dist/*.js' };
    expect(resolveExportsEntry(exports, './feature.js')).toBe('./dist/feature.js');
    expect(resolveExportsEntry(exports, './feature')).toBeUndefined();
  });

  it('does not match the package root against "./*"', () => {
    expect(resolveExportsEntry({ './*': './dist/*.js' }, '.')).toBeUndefined();
  });

  it('does not match a pattern with an empty part', () => {
    expect(resolveExportsEntry({ './a/*': './a/*.js' }, './a/')).toBeUndefined();
  });

  it('reads a string, an array or a conditions-only object as the root entry', () => {
    expect(resolveExportsEntry('./index.js', '.')).toBe('./index.js');
    expect(resolveExportsEntry(['./a.js', './b.js'], '.')).toEqual(['./a.js', './b.js']);
    expect(resolveExportsEntry({ import: './esm.js' }, '.')).toEqual({ import: './esm.js' });
    expect(resolveExportsEntry('./index.js', './sub')).toBeUndefined();
  });

  it('returns undefined without exports', () => {
    expect(resolveExportsEntry(undefined, './sub')).toBeUndefined();
  });

  it('returns undefined when no key matches', () => {
    expect(resolveExportsEntry({ './other': './o.js' }, './sub')).toBeUndefined();
  });
});
