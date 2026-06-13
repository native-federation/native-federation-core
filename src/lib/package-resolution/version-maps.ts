import type { PackageJsonRepository, VersionMap } from './package-json-repository.js';

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
