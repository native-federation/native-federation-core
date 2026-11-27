import semver from 'semver';
import {
  findDepPackageJson,
  getVersionMaps,
  type VersionMap,
} from '../utils/package/package-info.js';
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

type AutoRange = 'exact' | '^' | '~' | 'minor' | 'patch';

// A declared value semver cannot read (catalog:, workspace:, a dist-tag) is replaced by the installed version.
export function publishedRequiredVersion(
  declared: string,
  key: string,
  projectRoot: string,
  repo: PackageJsonRepository,
  opts?: { range?: AutoRange; version?: string }
): string {
  const explicit = !!opts?.version && opts.version !== 'auto';
  if (explicit || semver.validRange(declared)) {
    return opts ? applyAutoRequiredOptions(declared, opts) : declared;
  }

  const pkgJsonPath = findDepPackageJson(key, projectRoot, repo);
  const installed = semver.valid(pkgJsonPath ? repo.readJson(pkgJsonPath)['version'] : null);
  if (!installed) {
    return declared;
  }

  if (opts?.range) return applyAutoRequiredOptions(installed, { range: opts.range });
  // A floored range never admits a prerelease, so one keeps its tag.
  return semver.prerelease(installed)
    ? `~${installed}`
    : `~${semver.major(installed)}.${semver.minor(installed)}.0`;
}

export function applyAutoRequiredOptions(
  baseVersion: string,
  opts?: { range?: AutoRange; version?: string }
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
    /^(?:[~^<>=]*\s*)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?((?:-[\w.-]+)?(?:\+[\w.-]+)?)$/
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
