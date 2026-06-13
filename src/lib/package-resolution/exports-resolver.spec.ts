import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { findOptimalExport, replaceGlob, resolveExportsEntry } from './exports-resolver.js';
import type { PackageInfo } from './package-json-repository.js';

const info: PackageInfo = { packageName: 'p', entryPoint: '/pkg', version: '1.0.0', esm: false };

describe('replaceGlob', () => {
  it('replaces the asterisk in string leaves', () => {
    expect(replaceGlob('./dist/*.js', 'sub')).toBe('./dist/sub.js');
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

  it('resolves the first element of an array target', () => {
    const result = findOptimalExport(['./first.js', './second.js'], info);
    expect(result?.entryPoint).toBe(path.join('/pkg', './first.js'));
  });
});

describe('resolveExportsEntry', () => {
  it('matches an exact subpath key', () => {
    expect(resolveExportsEntry({ './sub': './dist/sub.js' }, './sub')).toBe('./dist/sub.js');
  });

  it('expands a trailing-asterisk subpath pattern', () => {
    expect(resolveExportsEntry({ './*': './dist/*.js' }, './feature')).toBe('./dist/feature.js');
  });

  it('returns undefined when no key matches', () => {
    expect(resolveExportsEntry({ './other': './o.js' }, './sub')).toBeUndefined();
  });
});
