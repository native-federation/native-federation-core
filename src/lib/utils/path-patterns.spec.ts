import { describe, expect, it } from 'vitest';
import { buildSync, type BuildFailure } from 'esbuild';
import {
  captureWildcard,
  isUnderAnyDir,
  isUnderDir,
  matchesExternal,
  matchesWildcard,
  parseWildcard,
  substituteWildcard,
  toGlobPattern,
  toPosix,
} from './path-patterns.js';

describe('isUnderDir', () => {
  it('matches a file nested under the dir, and the dir itself', () => {
    expect(isUnderDir('/dev/lib/src/a.ts', '/dev/lib')).toBe(true);
    expect(isUnderDir('/dev/lib', '/dev/lib')).toBe(true);
  });

  it('does not match a sibling that merely shares a name prefix', () => {
    expect(isUnderDir('/dev/lib-other/a.ts', '/dev/lib')).toBe(false);
  });

  // The regression this helper exists for: linkedSharedDirs and the file watcher both
  // emit posix, so a caller comparing with a native `\` separator matched nothing on
  // Windows and the npm-link rebuild trigger silently never fired.
  it('matches regardless of which separator either side arrives with', () => {
    expect(isUnderDir('C:/dev/lib/src/a.ts', 'C:/dev/lib')).toBe(true);
    expect(isUnderDir('C:\\dev\\lib\\src\\a.ts', 'C:/dev/lib')).toBe(true);
    expect(isUnderDir('C:/dev/lib/src/a.ts', 'C:\\dev\\lib')).toBe(true);
  });

  it('tolerates a trailing slash on the dir', () => {
    expect(isUnderDir('/dev/lib/src/a.ts', '/dev/lib/')).toBe(true);
  });
});

describe('isUnderAnyDir', () => {
  it('is true when any dir contains the file, false for none and for an empty list', () => {
    expect(isUnderAnyDir('/dev/b/x.ts', ['/dev/a', '/dev/b'])).toBe(true);
    expect(isUnderAnyDir('/dev/c/x.ts', ['/dev/a', '/dev/b'])).toBe(false);
    expect(isUnderAnyDir('/dev/a/x.ts', [])).toBe(false);
  });
});

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

describe('matchesExternal', () => {
  // Each pattern with what esbuild 0.28 keeps external for it; measured, then pinned below.
  const table: [string, Record<string, boolean>][] = [
    [
      'host-sdk',
      { 'host-sdk': true, 'host-sdk/events': true, 'host-sdk/a/b': true, 'host-sdkx': false },
    ],
    ['@scope/pkg', { '@scope/pkg': true, '@scope/pkg/sub': true, '@scope/pkg-other': false }],
    ['@icons/*.svg', { '@icons/home.svg': true, '@icons/a/b.svg': true, '@icons/home.png': false }],
    ['a*b', { ab: true, axb: true, b: false, a: false }],
    // Prefix and suffix may not overlap: 'a' would need its one character twice.
    ['a*a', { a: false, aa: true, aba: true }],
    ['@angular/*', { '@angular/core': true, '@angular/common/http': true, '@angular': false }],
    ['lodash/', { lodash: false, 'lodash/fp': false }],
  ];

  it.each(table)('reads %s the way the table says', (pattern, expected) => {
    for (const [specifier, kept] of Object.entries(expected)) {
      expect([specifier, matchesExternal(specifier, pattern)]).toEqual([specifier, kept]);
    }
  });

  // The validator trusts that the adapter left exactly these imports bare; esbuild is the
  // reference adapter, so the table must agree with it.
  it.each(table)('agrees with esbuild on %s', (pattern, expected) => {
    for (const specifier of Object.keys(expected)) {
      expect([specifier, keptExternalByEsbuild(specifier, pattern)]).toEqual([
        specifier,
        matchesExternal(specifier, pattern),
      ]);
    }
  });
});

// esbuild rejects a second '*' outright, so a config with one never builds; matchesExternal reads
// the rest after the first '*' as literal text. Recorded so a change to either is noticed.
describe('matchesExternal with more than one wildcard', () => {
  it('is rejected by esbuild', () => {
    expect(() => keptExternalByEsbuild('abc', 'a*b*c')).toThrow(/more than one "\*" wildcard/);
  });

  it('treats the second * as literal text', () => {
    expect(matchesExternal('a-b*c', 'a*b*c')).toBe(true);
    expect(matchesExternal('abxc', 'a*b*c')).toBe(false);
  });
});

// Nothing is installed for these names, so an import esbuild does not keep external fails to
// resolve; any other build error is a broken test and is rethrown.
function keptExternalByEsbuild(specifier: string, pattern: string): boolean {
  try {
    const { outputFiles } = buildSync({
      stdin: { contents: `import ${JSON.stringify(specifier)};` },
      bundle: true,
      write: false,
      format: 'esm',
      external: [pattern],
      logLevel: 'silent',
    });
    return outputFiles[0]!.text.includes(JSON.stringify(specifier));
  } catch (e) {
    const { errors } = e as BuildFailure;
    if (errors?.every(err => err.text.startsWith('Could not resolve'))) return false;
    throw e;
  }
}

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

describe('toGlobPattern', () => {
  it('keeps a prefix that already ends on a separator', () => {
    expect(toGlobPattern(parseWildcard('libs/ui/*'))).toBe('libs/ui/**/*');
  });

  // 'libs/ui-**' is not a globstar — tinyglobby reads it as 'libs/ui-*', which needs one more
  // directory level than the pattern does and so matches nothing.
  it('widens a prefix that stops mid-segment back to its directory', () => {
    expect(toGlobPattern(parseWildcard('libs/ui-*/src/index.ts'))).toBe('libs/**/*/src/index.ts');
  });

  it('drops to the workspace root when the prefix holds no separator', () => {
    expect(toGlobPattern(parseWildcard('ui-*/index.ts'))).toBe('**/*/index.ts');
  });
});
