export * from './lib/domain/config/index.js';

export { withNativeFederation } from './lib/config/with-native-federation.js';
export {
  /** @deprecated Core resolves the tsconfig itself; removed from the API in v5. */
  findRootTsConfigJson,
} from './lib/config/project-paths.js';
export {
  /** @deprecated Set `requiredVersion: 'auto'` on the shared entry; removed in v5. */
  setInferVersion,
} from './lib/config/version-lookup.js';
export {
  /** @deprecated Throws in v5. Use `fromPackageJson().filter([...]).override({...})`, each override a complete config. */
  share,
  shareAll,
  fromPackageJson,
} from './lib/config/share-utils.js';
export { mappingsFromWorkspace } from './lib/config/mapping-utils.js';
export { DEFAULT_SKIP_LIST } from './lib/config/default-skip-list.js';
