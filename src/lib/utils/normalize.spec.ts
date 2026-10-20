import { describe, expect, it } from 'vitest';
import { claimUniqueName, normalize, normalizePackageName } from './normalize.js';

describe('normalize', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalize('a\\b\\c')).toBe('a/b/c');
  });

  it('leaves the path untouched when trailingSlash is undefined', () => {
    expect(normalize('a/b/')).toBe('a/b/');
    expect(normalize('a/b///')).toBe('a/b///');
  });

  it('strips all trailing slashes when trailingSlash is false', () => {
    expect(normalize('a/b///', false)).toBe('a/b');
  });

  it('collapses to exactly one trailing slash when trailingSlash is true', () => {
    expect(normalize('a/b///', true)).toBe('a/b/');
    expect(normalize('a/b', true)).toBe('a/b/');
  });
});

describe('normalizePackageName', () => {
  it('replaces non-alphanumeric characters with underscores', () => {
    expect(normalizePackageName('foo.bar-baz')).toBe('foo_bar_baz');
  });

  it('strips a single leading underscore introduced by sanitization', () => {
    expect(normalizePackageName('@scope/pkg')).toBe('scope_pkg');
  });
});

describe('claimUniqueName', () => {
  it('suffixes a name that is already taken and claims the result', () => {
    const taken = new Set(['mapping-bundle']);

    expect(claimUniqueName('mapping-a', taken)).toBe('mapping-a');
    expect(claimUniqueName('mapping-a', taken)).toBe('mapping-a-2');
    expect(claimUniqueName('mapping-a', taken)).toBe('mapping-a-3');
    expect(claimUniqueName('mapping-bundle', taken)).toBe('mapping-bundle-2');
  });
});
