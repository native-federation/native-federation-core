import { logger } from '../logger.js';
import { normalize } from '../normalize.js';
import { getPkgFolder, sharedPackageJsonRepository } from '../io/package-json-repository.js';
import type {
  PackageInfo,
  PackageJsonRepository,
  VersionMap,
} from '../../domain/utils/package-json.contract.js';
import { resolvePackageInfo } from './entry-point-resolver.js';
import { getVersionMaps as getVersionMapsFromRepo } from './version-maps.js';

export { sharedPackageJsonRepository } from '../io/package-json-repository.js';
export type {
  PackageInfo,
  VersionMap,
  ExportCondition,
  ExportEntry,
} from '../../domain/utils/package-json.contract.js';
export { isESMExport } from './esm-detection.js';

export function tryGetPackageInfo(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): PackageInfo | null {
  workspaceRoot = normalize(workspaceRoot, true);

  for (const info of repo.getPackageJsonFiles(workspaceRoot, workspaceRoot)) {
    const cand = resolvePackageInfo(repo, packageName, info.directory);
    if (cand) {
      return cand;
    }
  }

  return null;
}

/**
 * Resolve a package that is expected to be resolvable, warning once if it is not.
 * Only use this where a failure is genuinely actionable, i.e. for packages the user
 * asked to share.
 */
export function getPackageInfo(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): PackageInfo | null {
  const info = tryGetPackageInfo(packageName, workspaceRoot, repo);

  if (!info) {
    logger.warn('No meta data found for shared lib ' + packageName);
    logger.warn(
      "If you don't need this package, skip it in your federation.config.js or consider moving it into depDependencies in your package.json"
    );
  }

  return info;
}

/**
 * Installed version per key, from each key's package root. Resolution is deduped by root:
 * `findDepPackageJson` trims to the root anyway, and that root package.json is also where
 * `resolvePackageInfo` reads the `version` it records as `PackageInfo.version`, so a secondary
 * yields the same string as its main entry point. Unresolvable keys map to ''.
 */
export function installedVersions(
  packageNames: string[],
  workspaceRoot: string,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): Record<string, string> {
  workspaceRoot = normalize(workspaceRoot, true);

  const byRoot = new Map<string, string>();
  const result: Record<string, string> = {};

  for (const packageName of packageNames) {
    const root = getPkgFolder(packageName);

    if (!byRoot.has(root)) {
      const pkgJsonPath = repo.findDepPackageJson(root, workspaceRoot);
      const version = pkgJsonPath ? (repo.readJson(pkgJsonPath)['version'] as string) : '';
      byRoot.set(root, version ?? '');
    }

    result[packageName] = byRoot.get(root)!;
  }

  return result;
}

export function getVersionMaps(
  project: string,
  workspace: string,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): VersionMap[] {
  return getVersionMapsFromRepo(repo, project, workspace);
}

export function findDepPackageJson(
  packageName: string,
  projectRoot: string,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): string | null {
  return repo.findDepPackageJson(packageName, projectRoot);
}
