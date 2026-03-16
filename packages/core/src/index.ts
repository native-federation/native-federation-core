export { setBuildAdapter } from './lib/core/build-adapter.js';

export { buildForFederation } from './lib/core/build-for-federation.js';
export { rebuildForFederation } from './lib/core/rebuild-for-federation.js';
export { createFederationCache } from './lib/core/federation-cache.js';
export { bundleExposedAndMappings } from './lib/core/bundle-exposed-and-mappings.js';
export { getExternals } from './lib/core/get-externals.js';
export { normalizeFederationOptions } from './lib/core/normalize-options.js';
export { writeFederationInfo } from './lib/core/write-federation-info.js';
export { type BuildHelperParams, federationBuilder } from './lib/core/federation-builder.js';

export * from './domain.js';
