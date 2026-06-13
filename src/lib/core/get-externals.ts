import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';

export function getExternals(config: NormalizedFederationConfig) {
  const shared = Object.keys(config.shared);
  const sharedMappings = Object.values(config.sharedMappings);
  const externals = [...shared, ...sharedMappings, ...config.externals];
  return externals;
}
