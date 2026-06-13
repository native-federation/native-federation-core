import type {
  PackageJsonRepository,
  VersionMap,
} from '../../domain/utils/package-json.contract.js';

/** Extract a `{ name: version }` map from every package.json's `dependencies`. */
export function getVersionMaps(
  repo: PackageJsonRepository,
  project: string,
  workspace: string
): VersionMap[] {
  return repo.getPackageJsonFiles(project, workspace).map(json => ({
    ...json.content['dependencies'],
  }));
}
