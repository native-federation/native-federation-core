import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type { UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { resolveMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import {
  expandWildcardMapping,
  isWildcardMapping,
  type MappingExpansionContext,
} from './expand-mappings.js';
import { inferPackageFromSecondary } from '../utils/normalize.js';
import { logger } from '../utils/logger.js';

export function removeUnusedDeps(
  usedDependencies: UsedDependencies,
  config: NormalizedFederationConfig,
  ctx: MappingExpansionContext
): NormalizedFederationConfig {
  // 'keepAll' is copied from a package onto every secondary entry point found for it, so it is
  // read per package family rather than per key: an unreachable secondary of a reachable package
  // survives -- that is the whole point -- but a package nothing reaches at all does not.
  const usedPackages = new Set([...usedDependencies.external].map(inferPackageFromSecondary));

  const filteredDependencies = Object.entries(config.shared)
    .filter(([shared, meta]) =>
      meta.includeSecondaries
        ? usedPackages.has(inferPackageFromSecondary(shared))
        : usedDependencies.external.has(shared)
    )
    .reduce((acc, [shared, meta]) => ({ ...acc, [shared]: meta }), {});

  // Both halves can contain wildcard-expanded imports, which the skip list has not seen yet.
  const sharedMappings = withoutSkippedMappings(
    { ...keptMappings(config, ctx), ...usedDependencies.internal },
    config.skip
  );

  // Invisible at build time: the build succeeds and remoteEntry.json is well-formed, just
  // without the workspace libraries, surfacing as a runtime NG0201 far from the cause. Legitimate
  // often enough to warn rather than throw.
  if (Object.keys(config.sharedMappings).length > 0 && Object.keys(sharedMappings).length === 0) {
    logger.warn(
      'No shared mapping is reachable from the entry points, so remoteEntry.json will ship ' +
        "without this workspace's libraries. Disable 'ignoreUnusedDeps' to publish them anyway."
    );
  }

  return {
    ...config,
    shared: filteredDependencies,
    sharedMappings,
  };
}

/** Mappings that opted out of reachability pruning, wildcards expanded on disk. */
function keptMappings(
  config: NormalizedFederationConfig,
  ctx: MappingExpansionContext
): PathToImport {
  const kept: PathToImport = {};

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    const mappingConfig = resolveMappingConfig(
      mappedImport,
      config.sharedMappingsConfig,
      config.features.mappingVersion
    );
    if (!mappingConfig.includeSecondaries) continue;

    if (!isWildcardMapping(mappedPath, mappedImport)) {
      kept[mappedPath] = mappedImport;
      continue;
    }

    // A wildcard entry is a pattern, not an entry point: without expansion the bundler
    // would be handed a path containing '*'. Only reachability can resolve it otherwise.
    if (!mappingConfig.resolveGlob) {
      logger.warn(
        `Mapping '${mappedImport}' opts out of pruning, but wildcard mappings need 'includeSecondaries: { resolveGlob: true }' to be expanded, and will be pruned.`
      );
      continue;
    }

    Object.assign(kept, expandWildcardMapping(mappedPath, mappedImport, ctx));
  }

  return kept;
}
