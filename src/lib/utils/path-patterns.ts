export const toPosix = (p: string): string => p.replace(/\\/g, '/');

/**
 * True when `file` is `dir` itself or lives under it. Both sides are normalized, so a
 * caller cannot splice in `path.sep` and get a predicate that is silently always-false
 * on Windows -- `linkedSharedDirs` and the file watcher both emit posix paths.
 */
export function isUnderDir(file: string, dir: string): boolean {
  const f = toPosix(file);
  const d = toPosix(dir).replace(/\/+$/, '');
  return f === d || f.startsWith(d + '/');
}

export const isUnderAnyDir = (file: string, dirs: readonly string[]): boolean =>
  dirs.some(d => isUnderDir(file, d));

export interface WildcardPattern {
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
}

export function parseWildcard(pattern: string): WildcardPattern {
  const i = pattern.indexOf('*');
  if (i === -1) return { prefix: pattern, suffix: '', hasWildcard: false };
  return { prefix: pattern.slice(0, i), suffix: pattern.slice(i + 1), hasWildcard: true };
}

export function matchesWildcard(value: string, pattern: string): boolean {
  const { prefix, suffix, hasWildcard } = parseWildcard(pattern);
  if (!hasWildcard) return value === pattern;
  return value.startsWith(prefix) && (suffix === '' || value.endsWith(suffix));
}

/**
 * End-anchored capture of the substring matched by `*` (which may span path
 * separators). Returns `null` when `value` does not fit the pattern.
 */
export function captureWildcard(value: string, pattern: WildcardPattern): string | null {
  const { prefix, suffix, hasWildcard } = pattern;
  if (!hasWildcard) return value === prefix ? '' : null;
  if (!value.startsWith(prefix)) return null;
  if (suffix && !value.endsWith(suffix)) return null;
  return suffix
    ? value.slice(prefix.length, value.length - suffix.length)
    : value.slice(prefix.length);
}

export function substituteWildcard(template: string, captured: string): string {
  return template.replace('*', captured);
}

/**
 * A glob that is a superset of the pattern, for callers that re-check the match themselves
 * (`captureWildcard`, `matchMapping`). `**` only acts as a globstar on a segment of its own,
 * so a prefix stopping mid-segment (`libs/ui-`) has to be widened back to its directory --
 * `libs/ui-**` reads as `libs/ui-*` and silently matches nothing one level down.
 */
export function toGlobPattern({ prefix, suffix }: WildcardPattern): string {
  return prefix.slice(0, prefix.lastIndexOf('/') + 1) + '**/*' + suffix;
}

/**
 * A dev checkout rather than an installed package. A symlink alone cannot tell them apart:
 * pnpm's default linker points every dep at `…/node_modules/.pnpm/<pkg>@<ver>/node_modules/
 * <pkg>`, while `npm link` resolves to the checkout. Matched anywhere in the path, since a
 * monorepo's store can sit above the workspace root, and by segment so a checkout under
 * `node_modules_backup` still counts.
 */
export const isOutsideNodeModules = (dir: string): boolean =>
  !toPosix(dir).split('/').includes('node_modules');
