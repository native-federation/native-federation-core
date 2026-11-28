import { logger } from '../logger.js';
import { normalize } from '../normalize.js';
import { getPkgFolder, sharedPackageJsonRepository } from '../io/package-json-repository.js';
import type {
  PackageInfo,
  PackageJsonRepository,
  VersionMap,
} from '../../domain/utils/package-json.contract.js';
import { resolvePackageInfo } from './entry-point-resolver.js';
import { NOT_EXPORTED, type NotExported } from './exports-resolver.js';
import { getVersionMaps as getVersionMapsFromRepo } from './version-maps.js';

export { sharedPackageJsonRepository } from '../io/package-json-repository.js';
export type { PackageInfo, VersionMap } from '../../domain/utils/package-json.contract.js';

export function tryGetPackageInfo(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository,
  platform: 'browser' | 'node'
): PackageInfo | null {
  const info = resolveFromRoots(packageName, workspaceRoot, repo, platform);
  return info === NOT_EXPORTED ? null : info;
}

export function getPackageInfo(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository,
  platform: 'browser' | 'node'
): PackageInfo | null {
  const info = resolveFromRoots(packageName, workspaceRoot, repo, platform);
  if (info && info !== NOT_EXPORTED) return info;

  if (info === NOT_EXPORTED) {
    logger.warn(
      `No meta data found for shared lib ${packageName}: its package.json exports blocks this entry point`
    );
    logger.warn('Skip it in your federation.config.js, or remove it from shared');
    return null;
  }

  logger.warn('No meta data found for shared lib ' + packageName);
  logger.warn(
    "If you don't need this package, skip it in your federation.config.js or consider moving it into devDependencies in your package.json"
  );
  return null;
}

function resolveFromRoots(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository,
  platform: 'browser' | 'node'
): PackageInfo | NotExported | null {
  workspaceRoot = normalize(workspaceRoot, true);

  for (const info of repo.getPackageJsonFiles(workspaceRoot, workspaceRoot)) {
    const cand = resolvePackageInfo(repo, packageName, info.directory, platform);
    if (cand) {
      return cand;
    }
  }

  return null;
}

// One lookup per package root: a secondary gets its root's version (see
// docs/architecture/package-resolution.md#reading-the-package); '' when not installed.
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
