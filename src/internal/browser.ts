// Browser-safe subset of the `./internal` entrypoint.

export { AbortedError } from '../lib/utils/errors.js';

export { densifyExternals, toDenseSharedInfoFormat } from '../lib/core/output/densify-externals.js';
export {
  /** @deprecated Unused by the adapters; removed in v5. */
  isInSkipList,
  /** @deprecated Unused by the adapters; removed in v5. */
  prepareSkipList,
} from '../lib/config/default-skip-list.js';

export type { PathToImport } from '../lib/domain/utils/mapped-path.contract.js';
export type {
  NormalizedExternalConfig,
  NormalizedSharedExternalsConfig,
} from '../lib/domain/config/external-config.contract.js';
export type { NormalizedFederationConfig } from '../lib/domain/config/federation-config.contract.js';
