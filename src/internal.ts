// Adapter toolkit. May change between minors, so pin core with `~`. Exported functions take no io
// ports: a `*Core` variant keeps the port and stays unexported.

export * from './internal/browser.js';

export {
  /** @deprecated Unused by the adapters; removed in v5. */
  hashFile,
} from './lib/utils/hash.js';
export { toDiskCase } from './lib/utils/disk-case.js';
export { logger, setLogLevel } from './lib/utils/logger.js';

export { RebuildQueue, type TrackResult } from './lib/core/rebuild-queue.js';

export {
  /** @deprecated `buildForFederation` writes it, and nothing reads importmap.json; removed in v5. */
  writeImportMap,
} from './lib/core/output/write-import-map.js';

export {
  getDefaultCachePath,
  /** @deprecated Unused by the adapters; removed in v5. */
  getChecksum,
} from './lib/core/cache/cache-persistence.js';
export { collectOutputFiles } from './lib/core/cache/federation-cache.js';

export type {
  NfFileWatcher,
  NfFileWatcherOptions,
} from './lib/domain/utils/file-watcher.contract.js';
export { syncNfFileWatcher, createNfWatcher, type WatchSources } from './lib/utils/file-watcher.js';
export type { WatchPort, WatchHandle } from './lib/domain/utils/io-port.contract.js';
export { linkedSharedDirs, sharedMappingDirs } from './lib/core/build/resolve-shared-dirs.js';
// Correlates watcher paths with linkedSharedDirs output; both are posix, so consumers
// must not hand-roll the prefix check with path.sep.
export { isUnderDir, isUnderAnyDir } from './lib/utils/path-patterns.js';
// For an adapter whose bundler does not read `external` the way core does.
export { matchesExternal } from './lib/utils/path-patterns.js';
export {
  createMappingImportResolver,
  type MappingImportResolver,
} from './lib/config/mapping-imports.js';
