import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type { UsedDependencies } from '../domain/utils/used-dependencies.contract.js';
import { resolveMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import {
  expandWildcardMapping,
  isWildcardMapping,
  keepsAll,
  resolvesGlob,
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

  return {
    ...config,
    shared: filteredDependencies,
    // Both halves can contain wildcard-expanded imports, which the skip list has not seen yet.
    sharedMappings: withoutSkippedMappings(
      { ...keptMappings(config, ctx), ...usedDependencies.internal },
      config.skip
    ),
  };
}

/** Mappings that opted out of reachability pruning, wildcards expanded on disk. */
function keptMappings(
  config: NormalizedFederationConfig,
  ctx: MappingExpansionContext
): PathToImport {
  const kept: PathToImport = {};

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    const includeSecondaries = resolveMappingConfig(
      mappedImport,
      config.sharedMappingsConfig
    )?.includeSecondaries;
    if (!keepsAll(includeSecondaries)) continue;

    if (!isWildcardMapping(mappedPath, mappedImport)) {
      kept[mappedPath] = mappedImport;
      continue;
    }

    // A wildcard entry is a pattern, not an entry point: without expansion the bundler
    // would be handed a path containing '*'. Only reachability can resolve it otherwise.
    if (!resolvesGlob(includeSecondaries)) {
      logger.warn(
        `Mapping '${mappedImport}' opts out of pruning, but wildcard mappings need 'includeSecondaries: { resolveGlob: true }' to be expanded, and will be pruned.`
      );
      continue;
    }

    Object.assign(kept, expandWildcardMapping(mappedPath, mappedImport, ctx));
  }

  return kept;
}
