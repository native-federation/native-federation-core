import { toPosix } from './path-patterns.js';

export function normalize(path: string, trailingSlash?: boolean): string {
  let cand = toPosix(path);

  if (typeof trailingSlash === 'undefined') {
    return cand;
  }

  while (cand.endsWith('/')) {
    cand = cand.substring(0, cand.length - 1);
  }

  if (trailingSlash) {
    return cand + '/';
  }

  return cand;
}

// Callers sanitize the variable part of a name to [A-Za-z0-9_], so a '-n' suffix never recreates
// an unsuffixed name.
export function claimUniqueName(name: string, taken: Set<string>): string {
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${name}-${n}`;
  taken.add(unique);
  return unique;
}

export function normalizePackageName(fileName: string) {
  const sanitized = fileName.replace(/[^A-Za-z0-9]/g, '_');
  return sanitized.startsWith('_') ? sanitized.slice(1) : sanitized;
}

export function inferPackageFromSecondary(secondary: string): string {
  const parts = secondary.split('/');
  if (secondary.startsWith('@') && parts.length >= 2) {
    return parts[0] + '/' + parts[1];
  }
  return parts[0]!;
}
