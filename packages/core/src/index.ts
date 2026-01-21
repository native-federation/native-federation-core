export { DEFAULT_SKIP_LIST } from './lib/core/default-skip-list.js';

export {
  type BuildAdapter,
  type BuildAdapterOptions,
  type BuildKind,
  type BuildResult,
  type EntryPoint,
  setBuildAdapter,
} from './lib/core/build-adapter.js';
export { buildForFederation } from './lib/core/build-for-federation.js';
export { bundleExposedAndMappings } from './lib/core/bundle-exposed-and-mappings.js';
export type { FederationOptions } from './lib/core/federation-options.js';
export { getExternals } from './lib/core/get-externals.js';
export { loadFederationConfig } from './lib/core/load-federation-config.js';
export { writeFederationInfo } from './lib/core/write-federation-info.js';

export { type BuildHelperParams, federationBuilder } from './lib/core/federation-builder.js';

export type {
  SharedInfo,
  FederationInfo,
  ExposesInfo,
} from './lib/domain/federation-info.contract.js';
export {
  type BuildNotificationOptions,
  BuildNotificationType,
} from './lib/domain/build-notification-options.contract.js';
