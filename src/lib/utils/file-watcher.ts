import { join } from 'path';
import type { WatchHandle, WatchPort, FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { NfFileWatcher, NfFileWatcherOptions } from '../domain/utils/file-watcher.contract.js';
import { nodeIo } from './io/node-io-adapter.js';
import { logger } from './logger.js';
import { toPosix } from './path-patterns.js';

export function createNfWatcher(options: NfFileWatcherOptions = {}): NfFileWatcher {
  return createNfWatcherCore(nodeIo, options);
}

export function createNfWatcherCore(
  io: WatchPort & FileReaderPort,
  options: NfFileWatcherOptions = {},
  now: () => number = Date.now
): NfFileWatcher {
  const { onChange } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const debounceMs = options.debounceMs ?? 0;
  const dedupeReplays = options.dedupeReplays ?? true;
  const replayGraceMs = options.replayGraceMs ?? 2000;
  const watchers = new Map<string, WatchHandle>();
  const dirtyPaths = new Set<string>();
  const mtimes = new Map<string, number>();

  // io.stat is lstat-based, so a symlinked file reports the link's own mtime.
  // Follow it, as maxMtime does in resolve-shared-dirs.ts.
  const mtimeOf = (path: string): number | null => {
    let stat = io.stat(path);
    if (stat?.isSymbolicLink) stat = io.stat(io.realpath(path));
    return stat?.mtimeMs ?? null;
  };

  const isReplay = (path: string): boolean => {
    const mtime = mtimeOf(path);
    if (mtime === null) {
      mtimes.delete(path); // deleted or renamed away — a rebuild must see it
      return false;
    }
    if (mtimes.get(path) !== mtime) {
      mtimes.set(path, mtime);
      return false;
    }
    // Same mtime. Only a replay once it is old enough to rule out a second save
    // inside one mtime tick and the addPaths seed race (see NfFileWatcherOptions).
    return now() - mtime >= replayGraceMs;
  };

  const deliver = (path: string) => {
    if (dedupeReplays && isReplay(path)) return;
    // Record before notifying: a listener may read get() synchronously and must
    // see itself.
    dirtyPaths.add(path);
    if (onChange) onChange(path);
  };

  // Coalesce bursts (ng-packagr emits several writes per rebuild) into one flush.
  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    for (const p of pending) deliver(p);
    pending.clear();
  };
  const notify = (path: string) => {
    if (debounceMs <= 0) return deliver(path);
    pending.add(path);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, debounceMs);
    flushTimer.unref?.();
  };

  return {
    addPaths(paths, opts) {
      const list = typeof paths === 'string' ? [paths] : [...paths];
      const poll = opts?.poll ? { intervalMs: pollIntervalMs } : undefined;
      for (const p of list) {
        if (watchers.has(p)) continue;
        const isDir = io.isDirectory(p);
        try {
          const handle = isDir
            ? io.watch(p, { recursive: true, poll }, filename => {
                if (filename) notify(toPosix(join(p, filename)));
              })
            : io.watch(p, { recursive: false, poll }, () => notify(toPosix(p)));
          watchers.set(p, handle);
        } catch {
          logger.debug(`Could not watch path '${p}'.`);
          continue;
        }
        // Seed so the first replay after startup is already recognised as one.
        // Directories are skipped: seeding a recursive watch means walking the tree,
        // and their entries seed themselves on the event that first reports them.
        if (dedupeReplays && !isDir) {
          const key = toPosix(p);
          if (!mtimes.has(key)) {
            const mtime = mtimeOf(key);
            if (mtime !== null) mtimes.set(key, mtime);
          }
        }
      }
    },

    get: () => dirtyPaths,
    clear: () => dirtyPaths.clear(),
    mutate: fn => fn(dirtyPaths),

    async close() {
      if (flushTimer) clearTimeout(flushTimer);
      for (const handle of watchers.values()) {
        handle.close();
      }
      watchers.clear();
    },
  };
}

/** A bundler cache keyed by input path, or the input paths themselves. */
export type WatchSources = Iterable<string> | { keys(): Iterable<string> };

// Arrays expose keys() too, but it yields indices — rule one out before treating
// a source as a cache.
function toPaths(sources: WatchSources): Iterable<string> {
  if (Array.isArray(sources)) return sources;
  const cache = sources as { keys?: () => Iterable<string> };
  return typeof cache.keys === 'function' ? cache.keys() : (sources as Iterable<string>);
}

/**
 * Subscribe the watcher to the inputs the last build compiled.
 *
 * Passing a bundler cache only works when it is keyed by input path. A cache that
 * records its inputs elsewhere yields an empty watch set and, silently, a dev server
 * that serves stale bundles until restart — Angular's `SourceFileCache` extends `Map`
 * but keeps its inputs in `typeScriptFileCache`/`referencedFiles`, which is
 * angular-adapter#94. Adapters over such a cache must expand it and pass the paths.
 */
export function syncNfFileWatcher(
  watcher: NfFileWatcher,
  sources: WatchSources,
  // Realpath'd dirs of symlinked (npm-linked) shared packages — watched despite
  // living under node_modules. See core's `linkedSharedDirs`.
  linkedDirs: readonly string[] = []
): void {
  const files = [...toPaths(sources)].filter(k => !k.includes('node_modules'));
  if (files.length) watcher.addPaths(files);
  if (linkedDirs.length) watcher.addPaths(linkedDirs, { poll: true });
}
