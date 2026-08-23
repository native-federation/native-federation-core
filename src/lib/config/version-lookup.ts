import { getVersionMaps, type VersionMap } from '../utils/package/package-info.js';
import type { PackageJsonRepository } from '../domain/utils/package-json.contract.js';

let inferVersion = false;

export function setInferVersion(infer: boolean): void {
  inferVersion = infer;
}

export function isInferVersion(): boolean {
  return inferVersion;
}

export function lookupVersion(
  key: string,
  workspaceRoot: string,
  repo: PackageJsonRepository
): string {
  const versionMaps = getVersionMaps(workspaceRoot, workspaceRoot, repo);

  for (const versionMap of versionMaps) {
    const version = lookupVersionInMap(key, versionMap);

    if (version) {
      return version;
    }
  }

  throw new Error(
    `Shared Dependency ${key} has requiredVersion:'auto'. However, this dependency is not found in your package.json`
  );
}

function lookupVersionInMap(key: string, versions: VersionMap): string | null {
  const parts = key.split('/');
  if (parts.length >= 2 && parts[0]!.startsWith('@')) {
    key = parts[0] + '/' + parts[1];
  } else {
    key = parts[0]!;
  }

  if (!versions[key]) {
    return null;
  }
  return versions[key]!;
}

/**
 * Apply auto-options to a base version string (the value read from package.json).
 * - If opts is undefined or opts.range is not provided, returns baseVersion unchanged.
 * - If opts.range is provided, attempts to format a single-token semver according to the
 *   requested range. Complex multi-comparator ranges are left unchanged.
 */
export function applyAutoRequiredOptions(
  baseVersion: string,
  opts?: { range?: 'exact' | '^' | '~' | 'minor' | 'patch' }
): string {
  if (!opts || !opts.range) return baseVersion;

  const requested = opts.range;

  const raw = (baseVersion ?? '').trim();
  // Recognize a single-version token possibly prefixed by common chars: ^ ~ = v >= <=
  // Examples matched: '^1.2.3', '1.2.3', 'v1.2.3', '~1.2.3', '>=1.2.3'
  const singleTokenMatch = raw.match(/^\s*([=^~v<>]*\s*)?(\d+\.\d+\.\d+(?:[-+.][\w.]+)?)\s*$/);
  if (!singleTokenMatch) {
    // Not a simple single token — do not attempt to rewrite complex ranges.
    return raw;
  }

  const bareVersion = singleTokenMatch[2];

  // Map named options to emitted form. 'minor' => '^', 'patch' => '~'.
  switch (requested) {
    case 'exact':
      return `${bareVersion}`;
    case '^':
    case 'minor':
      return `^${bareVersion}`;
    case '~':
    case 'patch':
      return `~${bareVersion}`;
    default:
      return raw;
  }
}
