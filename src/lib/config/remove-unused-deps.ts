import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type { UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { resolveMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import {
  expandWildcardMapping,
  isWildcardMapping,
  type MappingExpansionContext,
} from './expand-mappings.js';
import { logger } from '../utils/logger.js';

export function removeUnusedDeps(
  usedDependencies: UsedDependencies,
  config: NormalizedFederationConfig,
  ctx: MappingExpansionContext
): NormalizedFederationConfig {
  const filteredDependencies = Object.entries(config.shared)
    .filter(([shared, meta]) => !!meta.includeSecondaries || usedDependencies.external.has(shared))
    .reduce((acc, [shared, meta]) => ({ ...acc, [shared]: meta }), {});

  // Both halves can contain wildcard-expanded imports, which the skip list has not seen yet.
  const sharedMappings = withoutSkippedMappings(
    { ...keptMappings(config, ctx), ...usedDependencies.internal },
    config.skip
  );

  // Only a trace: a project that reaches none of the workspace's mappings prunes them all,
  // and in a workspace whose tsconfig declares one path per library that is the common case.
  // The mismatch this used to warn about is reported from resolveUsedMappings, which can tell
  // the two apart.
  if (Object.keys(config.sharedMappings).length > 0 && Object.keys(sharedMappings).length === 0) {
    logger.debug(
      'All shared mappings were pruned as unreachable from the entry points. Disable the ' +
        "'ignoreUnusedDeps' feature to publish them anyway."
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
