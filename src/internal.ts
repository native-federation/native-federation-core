/**
 * Internal API's of the native-federation builder.
 *
 * Might change between minors.
 */

export * from './internal/browser.js';

export * from './lib/core/build/build-result-map.js';

export { hashFile } from './lib/utils/hash-file.js';
export { logger, setLogLevel } from './lib/utils/logger.js';

export { RebuildQueue, type TrackResult } from './lib/core/rebuild-queue.js';

export { writeImportMap } from './lib/core/output/write-import-map.js';

export { getDefaultCachePath, getChecksum } from './lib/core/cache/cache-persistence.js';
export {
  isESMExport,
  type ExportCondition,
  type ExportEntry,
} from './lib/utils/package/package-info.js';
export {
  isCjsCandidate,
  classifyByExtension,
  hasEsmSyntax,
  type ModuleFormat,
} from './lib/utils/package/esm-detection.js';
export {
  isIdentifierName,
  planCjsWrap,
  buildSyntheticCjsEntry,
  isEsmInteropError,
} from './lib/utils/package/cjs-named-exports.js';

export type {
  NfFileWatcher,
  NfFileWatcherOptions,
} from './lib/domain/utils/file-watcher.contract.js';
export { syncNfFileWatcher, createNfWatcher } from './lib/utils/file-watcher.js';
export { linkedSharedDirs } from './lib/core/build/resolve-shared-dirs.js';
