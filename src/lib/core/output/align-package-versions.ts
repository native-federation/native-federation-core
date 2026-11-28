import type { SharedInfo } from '../../domain/core/federation-info.contract.js';
import { packageSources } from '../../config/package-config.js';

// The config is aligned per package when it is read; the version is only known per entry point,
// from its own package.json. see docs/architecture/shared-packages.md
export function alignPackageVersions(
  shared: SharedInfo[],
  packageOf: (name: string) => string
): SharedInfo[] {
  const byName = new Map(shared.map(entry => [entry.packageName, entry]));
  const sources = packageSources(byName.keys(), packageOf);

  return shared.map(entry => {
    const source = byName.get(sources.get(packageOf(entry.packageName))!)!;
    if (source.version === entry.version && source.requiredVersion === entry.requiredVersion) {
      return entry;
    }
    const { version: _version, ...rest } = entry;
    return {
      ...rest,
      requiredVersion: source.requiredVersion,
      ...(source.version !== undefined && { version: source.version }),
    };
  });
}
