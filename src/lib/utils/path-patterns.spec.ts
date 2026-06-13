import { describe, expect, it } from 'vitest';
import {
  captureWildcard,
  matchesWildcard,
  parseWildcard,
  substituteWildcard,
  toPosix,
} from './path-patterns.js';

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('a\\b\\c')).toBe('a/b/c');
  });

  it('leaves posix paths unchanged (idempotent)', () => {
    expect(toPosix('a/b/c')).toBe('a/b/c');
    expect(toPosix(toPosix('a\\b'))).toBe('a/b');
  });

  it('handles mixed separators', () => {
    expect(toPosix('a\\b/c\\d')).toBe('a/b/c/d');
  });
});

describe('parseWildcard', () => {
  it('reports no wildcard for a plain pattern', () => {
    expect(parseWildcard('lib/index')).toEqual({
      prefix: 'lib/index',
      suffix: '',
      hasWildcard: false,
    });
  });

  it('splits on the first asterisk', () => {
    expect(parseWildcard('./features/*.js')).toEqual({
      prefix: './features/',
      suffix: '.js',
      hasWildcard: true,
    });
  });

  it('handles a trailing asterisk (empty suffix)', () => {
    expect(parseWildcard('@scope/pkg*')).toEqual({
      prefix: '@scope/pkg',
      suffix: '',
      hasWildcard: true,
    });
  });

  it('handles a leading asterisk (empty prefix)', () => {
    expect(parseWildcard('*.js')).toEqual({ prefix: '', suffix: '.js', hasWildcard: true });
  });
});

describe('matchesWildcard', () => {
  it('exact-matches when there is no wildcard', () => {
    expect(matchesWildcard('foo', 'foo')).toBe(true);
    expect(matchesWildcard('foobar', 'foo')).toBe(false);
  });

  it('matches by prefix for a trailing-asterisk pattern (skip-list semantics)', () => {
    expect(matchesWildcard('@angular/core', '@angular/*')).toBe(true);
    expect(matchesWildcard('@angular/common', '@angular/*')).toBe(true);
    expect(matchesWildcard('react', '@angular/*')).toBe(false);
  });

  it('requires both prefix and suffix when both are present', () => {
    expect(matchesWildcard('a/x/b.js', 'a/*.js')).toBe(true);
    expect(matchesWildcard('a/x/b.ts', 'a/*.js')).toBe(false);
  });
});

describe('captureWildcard', () => {
  it('captures the segment for a suffix pattern (end-anchored, multi-segment)', () => {
    expect(captureWildcard('features/a/b.js', parseWildcard('features/*.js'))).toBe('a/b');
  });

  it('captures the remainder when there is no suffix', () => {
    expect(captureWildcard('pkg/sub/deep', parseWildcard('pkg/*'))).toBe('sub/deep');
  });

  it('returns null when the value does not fit the pattern', () => {
    expect(captureWildcard('other/a.js', parseWildcard('features/*.js'))).toBeNull();
    expect(captureWildcard('features/a.ts', parseWildcard('features/*.js'))).toBeNull();
  });

  it('handles a wildcard-less pattern as exact equality', () => {
    expect(captureWildcard('lib', parseWildcard('lib'))).toBe('');
    expect(captureWildcard('libx', parseWildcard('lib'))).toBeNull();
  });
});

describe('substituteWildcard', () => {
  it('replaces the first asterisk with the captured value', () => {
    expect(substituteWildcard('@pkg/*', 'a/b')).toBe('@pkg/a/b');
  });

  it('only replaces the first asterisk', () => {
    expect(substituteWildcard('a/*/b/*', 'X')).toBe('a/X/b/*');
  });
});
