export type {
  ExternalConfig,
  IncludeSecondariesOptions,
  SharedExternalsConfig,
  ShareExternalsOptions,
  ShareAllExternalsOptions,
} from './lib/config/external-config.contract.js';
export type { FederationConfig } from './lib/config/federation-config.contract.js';
export { withNativeFederation } from './lib/config/with-native-federation.js';
export { findRootTsConfigJson, share, shareAll } from './lib/config/share-utils.js';
