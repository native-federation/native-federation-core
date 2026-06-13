// Shared path/wildcard helpers for single-`*` subpath patterns (Node "exports"
// subpaths, tsconfig path mappings).

export const toPosix = (p: string): string => p.replace(/\\/g, '/');

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

/** Prefix(+optional suffix) match; exact equality without a `*`. */
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
