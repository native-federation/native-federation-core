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

export function applyAutoRequiredOptions(
  baseVersion: string,
  opts?: { range?: 'exact' | '^' | '~' | 'minor' | 'patch'; version?: string }
): string {
  const explicit = opts?.version && opts.version !== 'auto' ? opts.version : undefined;
  const raw = (explicit ?? baseVersion ?? '').trim();

  if (!opts || !opts.range) return raw;

  const requested = opts.range;

  // Recognize a single-version token possibly prefixed by common chars: ^ ~ = v >= <=
  // Examples matched: '^1.2.3', '1.2.3', 'v1.2.3', '~1.2.3', '>=1.2.3', '1', '1.2'
  // Minor/patch segments are optional and default to '0'. Still anchored end-to-end so
  // complex multi-comparator ranges (e.g. '>=1.0.0 <2.0.0') fall through unchanged.
  const singleTokenMatch = raw.match(
    /^(?:[~^<>=]*\s*)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?((?:[-+][\w.]+)?)$/
  );
  if (!singleTokenMatch) {
    return raw;
  }

  const [, major, minor = '0', patch = '0', extra] = singleTokenMatch;
  const bareVersion = `${major}.${minor}.${patch}${extra}`;

  switch (requested) {
    case 'exact':
      return bareVersion;
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
