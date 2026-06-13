import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIP_LIST, isInSkipList, prepareSkipList } from './default-skip-list.js';

describe('prepareSkipList', () => {
  it('partitions entries into strings, functions and regexps', () => {
    const fn = (s: string) => s === 'x';
    const re = /foo/;
    const prepared = prepareSkipList(['a', 'b', fn, re]);

    expect(prepared.strings).toEqual(new Set(['a', 'b']));
    expect(prepared.functions).toEqual([fn]);
    expect(prepared.regexps).toEqual([re]);
  });

  it('produces empty collections for an empty skip list', () => {
    const prepared = prepareSkipList([]);

    expect(prepared.strings.size).toBe(0);
    expect(prepared.functions).toEqual([]);
    expect(prepared.regexps).toEqual([]);
  });

  it('treats DEFAULT_SKIP_LIST entries by their runtime type', () => {
    const prepared = prepareSkipList(DEFAULT_SKIP_LIST);

    expect(prepared.strings.has('@softarc/native-federation')).toBe(true);
    expect(prepared.functions.length).toBe(1);
    expect(prepared.regexps).toEqual([]);
  });
});

describe('isInSkipList', () => {
  it('matches exact string entries', () => {
    const skip = prepareSkipList(['react']);
    expect(isInSkipList('react', skip)).toBe(true);
    expect(isInSkipList('react-dom', skip)).toBe(false);
  });

  it('matches via predicate functions', () => {
    const skip = prepareSkipList([(name: string) => name.startsWith('@types/')]);
    expect(isInSkipList('@types/node', skip)).toBe(true);
    expect(isInSkipList('node', skip)).toBe(false);
  });

  it('matches via regular expressions', () => {
    const skip = prepareSkipList([/^@angular\//]);
    expect(isInSkipList('@angular/core', skip)).toBe(true);
    expect(isInSkipList('rxjs', skip)).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(isInSkipList('anything', prepareSkipList([]))).toBe(false);
  });

  it('skips the @types/ scope through DEFAULT_SKIP_LIST', () => {
    const skip = prepareSkipList(DEFAULT_SKIP_LIST);
    expect(isInSkipList('@types/jest', skip)).toBe(true);
    expect(isInSkipList('es-module-shims', skip)).toBe(true);
    expect(isInSkipList('some-other-lib', skip)).toBe(false);
  });
});
