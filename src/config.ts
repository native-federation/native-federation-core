export * from './lib/domain/config/index.js';

export { withNativeFederation } from './lib/config/with-native-federation.js';
export { findRootTsConfigJson } from './lib/config/project-paths.js';
export { setInferVersion } from './lib/config/version-lookup.js';
export { share, shareAll, fromPackageJson } from './lib/config/share-utils.js';
export { DEFAULT_SKIP_LIST } from './lib/config/default-skip-list.js';
