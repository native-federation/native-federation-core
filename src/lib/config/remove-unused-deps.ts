import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { UsedDependencies } from '../domain/utils/used-dependencies.contract.js';

export function removeUnusedDeps(
  usedDependencies: UsedDependencies,
  config: NormalizedFederationConfig
): NormalizedFederationConfig {
  const filteredDependencies = Object.entries(config.shared)
    .filter(([shared, meta]) => !!meta.includeSecondaries || usedDependencies.external.has(shared))
    .reduce((acc, [shared, meta]) => ({ ...acc, [shared]: meta }), {});

  return {
    ...config,
    shared: filteredDependencies,
    sharedMappings: usedDependencies.internal,
  };
}
