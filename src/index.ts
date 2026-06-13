export { setBuildAdapter } from './lib/core/build/build-adapter.js';

export { buildForFederation } from './lib/core/build/build-for-federation.js';
export { rebuildForFederation } from './lib/core/build/rebuild-for-federation.js';
export { createFederationCache } from './lib/core/cache/federation-cache.js';
export { bundleExposedAndMappings } from './lib/core/build/bundle-exposed-and-mappings.js';
export { getExternals } from './lib/core/build/get-externals.js';
export { normalizeFederationOptions } from './lib/core/normalize-options.js';
export { writeFederationInfo } from './lib/core/output/write-federation-info.js';
export { type BuildHelperParams, federationBuilder } from './lib/core/federation-builder.js';

export * from './domain.js';
