import type { NormalizedFederationConfig } from '../config/federation-config.js';

export function getExternals(config: NormalizedFederationConfig) {
  const shared = Object.keys(config.shared);
  const sharedMappings = config.sharedMappings.map(m => m.key);
  const externals = [...shared, ...sharedMappings, ...config.externals];
  return externals;
}
