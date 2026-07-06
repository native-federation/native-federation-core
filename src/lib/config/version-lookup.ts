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
