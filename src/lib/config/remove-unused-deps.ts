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
  // share-utils copies 'keepAll' onto every secondary it finds, so it is read per family: an
  // unreached secondary of a reached package survives, a family nothing reaches does not.
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

  // Legitimate often enough to warn rather than throw, but invisible otherwise: the build
  // succeeds and only surfaces as a runtime NG0201, far from the cause.
  warnOnUnresolvableSubpaths(
    usedDependencies.mappingImports,
    new Set(Object.values(sharedMappings))
  );

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

// esbuild treats every subpath of an external as external and keeps it verbatim, but the import
// map only has a key for the mapping itself, so the import fails at runtime.
function warnOnUnresolvableSubpaths(
  specifiers: ReadonlyMap<string, string> | undefined,
  published: ReadonlySet<string>
): void {
  for (const [specifier, importer] of specifiers ?? []) {
    if (published.has(specifier)) continue;

    for (let i = specifier.lastIndexOf('/'); i > 0; i = specifier.lastIndexOf('/', i - 1)) {
      const mapping = specifier.slice(0, i);
      if (!published.has(mapping)) continue;

      logger.warn(
        `'${importer}' imports '${specifier}', a subpath of the shared mapping '${mapping}'. ` +
          `The bundler keeps it external, but the import map cannot resolve it. Import a ` +
          `mapping by its exact name instead.`
      );
      break;
    }
  }
}

// Mappings that opted out of reachability pruning, wildcards expanded on disk.
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

    // A wildcard is a pattern, not an entry point: unexpanded, the bundler gets a path with '*'.
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
