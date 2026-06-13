import { logger } from '../logger.js';
import { normalize } from '../normalize.js';
import { sharedPackageJsonRepository } from '../io/package-json-repository.js';
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

export function getPackageInfo(
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

  logger.warn('No meta data found for shared lib ' + packageName);
  return null;
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
