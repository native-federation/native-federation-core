export type {
  SharedInfo,
  DenseSharedInfo,
  FederationInfo,
  ExposesInfo,
  /** @deprecated Only `bundleExposedAndMappings` returns it; removed from the API in v5. */
  ArtifactInfo,
  ChunkInfo,
  IntegrityMap,
  OutputFile,
} from './federation-info.contract.js';
export {
  type BuildNotificationOptions,
  BuildNotificationType,
} from './build-notification-options.contract.js';
export type {
  FederationOptions,
  NormalizedFederationOptions,
} from './federation-options.contract.js';
export type {
  EntryPoint,
  ExternalsCacheKey,
  NFBuildAdapterOptions,
  NFBuildAdapter,
  NFBuildAdapterResult,
  /** @deprecated Core never reads it; it moves to the adapters in v5. */
  NFBuildAdapterContext,
  NFAdapterInput,
  NFBundleKind,
} from './build-adapter.contract.js';
export { CHUNK_PREFIX, toChunkImport } from './chunk.js';
export type { FederationCache } from './federation-cache.contract.js';
export type {
  /** @deprecated Core never reads a manifest; the orchestrator has its own type. Removed in v5. */
  FederationManifest,
} from './manifest.contract.js';
