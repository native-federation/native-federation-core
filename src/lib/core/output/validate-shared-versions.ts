import type {
  DenseSharedInfo,
  FederationInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import type { FederationCache } from '../../domain/core/federation-cache.contract.js';
import { mappingPackageByImport } from '../../config/mapping-utils.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';
import { logger } from '../../utils/logger.js';

export interface VersionConflict {
  packageName: string;
  shareScope?: string;
  versions: string[];
}

const reportedConflicts = new WeakMap<FederationCache, string>();

// The runtime elects and serves a singleton package as one unit at one version: a remote that
// publishes two versions of it is left to run its own copy of the whole package.
export function validateSharedVersions(
  config: NormalizedFederationConfig,
  federationInfo: FederationInfo,
  cache: FederationCache,
  { fullReport }: { fullReport: boolean }
): void {
  const conflicts = findVersionConflicts(federationInfo.shared, mappingPackageByImport(config));
  const strict = config.features.strictImports;

  const key = JSON.stringify(conflicts);
  const previous = reportedConflicts.get(cache);
  reportedConflicts.set(cache, key);
  if (conflicts.length === 0 || (!strict && !fullReport && key === previous)) return;

  const report = strict ? logger.error : logger.warn;
  for (const { packageName, shareScope, versions } of conflicts) {
    const scope = shareScope ? ` in share scope '${shareScope}'` : '';
    report(
      `'${packageName}'${scope} is published at ${versions.join(', ')}. The runtime shares a ` +
        `package at one version, so this remote would load its own copy of '${packageName}'. ` +
        `Give its entry points one version (packageInfo.version, or the installed one).`
    );
  }
  if (strict) {
    throw new Error(
      `${conflicts.length} shared package(s) published at more than one version ` +
        `(features.strictImports). See the errors above.`
    );
  }
}

export function findVersionConflicts(
  shared: Array<SharedInfo | DenseSharedInfo>,
  declaredPackages: ReadonlyMap<string, string>
): VersionConflict[] {
  const groups = new Map<string, VersionConflict & { seen: Set<string> }>();

  for (const entry of shared) {
    if (!entry.singleton) continue;
    // A dense record is named after its package already.
    const packageName =
      'entries' in entry
        ? entry.packageName
        : (declaredPackages.get(entry.packageName) ?? inferPackageFromSecondary(entry.packageName));
    const key = JSON.stringify([entry.shareScope ?? '', packageName]);
    const group = groups.get(key) ?? {
      packageName,
      ...(entry.shareScope && { shareScope: entry.shareScope }),
      versions: [],
      seen: new Set<string>(),
    };
    groups.set(key, group);

    const version = entry.version ?? '(none)';
    if (!group.seen.has(version)) {
      group.seen.add(version);
      group.versions.push(version);
    }
  }

  return [...groups.values()]
    .filter(group => group.versions.length > 1)
    .map(({ seen: _seen, ...conflict }) => conflict);
}
