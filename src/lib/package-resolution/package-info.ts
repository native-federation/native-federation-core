import { logger } from '../utils/logger.js';
import { normalize } from '../utils/normalize.js';
import {
  createPackageJsonRepository,
  type PackageInfo,
  type PackageJsonRepository,
  type VersionMap,
} from './package-json-repository.js';
import { resolvePackageInfo } from './entry-point-resolver.js';
import { getVersionMaps as getVersionMapsFromRepo } from './version-maps.js';

export type { PackageInfo, VersionMap } from './package-json-repository.js';
export {
  isESMExport,
  type ExportCondition,
  type ExportEntry,
} from './esm-detection.js';

export const defaultRepo = createPackageJsonRepository();

export function getPackageInfo(
  packageName: string,
  workspaceRoot: string,
  repo: PackageJsonRepository = defaultRepo
): PackageInfo | null {
  workspaceRoot = normalize(workspaceRoot, true);

  for (const info of repo.getPackageJsonFiles(workspaceRoot, workspaceRoot)) {
    const cand = resolvePackageInfo(repo, packageName, info.directory);
    if (cand) {
      return cand;
    }
  }

  logger.warn('No meta data found for shared lib ' + packageName);
  return null;
}

export function getVersionMaps(
  project: string,
  workspace: string,
  repo: PackageJsonRepository = defaultRepo
): VersionMap[] {
  return getVersionMapsFromRepo(repo, project, workspace);
}

export function findDepPackageJson(
  packageName: string,
  projectRoot: string,
  repo: PackageJsonRepository = defaultRepo
): string | null {
  return repo.findDepPackageJson(packageName, projectRoot);
}
