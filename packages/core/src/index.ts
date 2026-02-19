export { setBuildAdapter } from './lib/core/build-adapter.js';

export { buildForFederation, rebuildForFederation } from './lib/core/build-for-federation.js';
export { bundleExposedAndMappings } from './lib/core/bundle-exposed-and-mappings.js';
export { getExternals } from './lib/core/get-externals.js';
export { loadFederationConfig } from './lib/core/load-federation-config.js';
export { writeFederationInfo } from './lib/core/write-federation-info.js';

export { type BuildHelperParams, federationBuilder } from './lib/core/federation-builder.js';

export * from './domain.js';
