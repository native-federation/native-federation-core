import { dirname, join } from 'path';
import type { WatchHandle, WatchPort, FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { NfFileWatcher, NfFileWatcherOptions } from '../domain/utils/file-watcher.contract.js';
import { nodeIo } from './io/node-io-adapter.js';
import { logger } from './logger.js';
import { isOutsideNodeModules, isUnderDir, toPosix } from './path-patterns.js';

export function createNfWatcher(options: NfFileWatcherOptions = {}): NfFileWatcher {
  return createNfWatcherCore(nodeIo, options);
}

export function createNfWatcherCore(
  io: WatchPort & FileReaderPort,
  options: NfFileWatcherOptions = {},
  now: () => number = Date.now
): NfFileWatcher {
  const { onChange } = options;
  const watch: WatchPort['watch'] = options.watch ?? ((p, o, cb) => io.watch(p, o, cb));
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const debounceMs = options.debounceMs ?? 0;
  const dedupeReplays = options.dedupeReplays ?? true;
  const replayGraceMs = options.replayGraceMs ?? 2000;
  const watchers = new Map<string, DirWatch>();
  const dirtyPaths = new Set<string>();
  const lastSeen = new Map<string, FileIdentity>();
  // Files are watched through their containing directory, never individually;
  // trackedFiles narrows the directory's events back down to them. See AGENTS.md
  // "File watches go through the directory".
  const trackedFiles = new Set<string>();
  const fileDirWatchers = new Map<string, DirWatch>();

  // One key per directory, so the same dir spelled two ways does not open a second
  // handle. Both maps are keyed with it, and so are the coverage checks below.
  const dirKey = (p: string): string => {
    const posix = toPosix(p);
    return posix.length > 1 ? posix.replace(/\/+$/, '') : posix;
  };

  // A polled watch survives the inode replacement a native one misses (the reason
  // linkedDirs poll at all), so it can stand in for a native watch but never the
  // other way round.
  const covers = (path: string, poll: boolean): boolean => {
    for (const [dir, watch] of watchers) {
      if ((watch.poll || !poll) && isUnderDir(path, dir)) return true;
    }
    return false;
  };

  // A recursive watch reports every entry under it, so it supersedes the narrower
  // watches it covers. Without this a file added before the directory containing it
  // keeps its own watch and every save there reports twice.
  const supersede = (dir: string, poll: boolean) => {
    for (const map of [watchers, fileDirWatchers]) {
      for (const [key, watch] of map) {
        if (watch.poll && !poll) continue;
        if (map === watchers && key === dir) continue;
        if (!isUnderDir(key, dir)) continue;
        watch.handle.close();
        map.delete(key);
      }
    }
  };

  // io.stat is lstat-based, so a symlink reports its own mtime and length, not the
  // target's. Follow it, as maxMtime does in resolve-shared-dirs.ts.
  const identityOf = (path: string): FileIdentity | null => {
    let stat = io.stat(path);
    if (stat?.isSymbolicLink) stat = io.stat(io.realpath(path));
    return stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : null;
  };

  // Identity first, clock only for what identity cannot settle; a negative age
  // delivers. See AGENTS.md "Replay dedupe" for why 2000 is the default.
  const isReplay = (path: string, at: number): boolean => {
    const current = identityOf(path);
    if (!current) {
      lastSeen.delete(path); // deleted or renamed away — a rebuild must see it
      return false;
    }
    const previous = lastSeen.get(path);
    lastSeen.set(path, current);
    if (!previous || previous.mtimeMs !== current.mtimeMs || previous.size !== current.size) {
      return false;
    }
    return at - current.mtimeMs >= replayGraceMs;
  };

  // Warn once, then fall back to debug: descriptor exhaustion fails every
  // subsequent directory too. See AGENTS.md "Watch failures are visible".
  let watchFailures = 0;
  const watchFailed = (path: string) => {
    if (++watchFailures > 1) return logger.debug(`Could not watch path '${path}'.`);
    logger.warn(
      `Could not watch '${path}'. Changes there will not trigger a rebuild; ` +
        `run with verbose logging to see any further watch failures.`
    );
  };

  const deliver = (path: string, at: number) => {
    if (dedupeReplays && isReplay(path, at)) return;
    // Record before notifying: a listener may read get() synchronously and must
    // see itself.
    dirtyPaths.add(path);
    if (onChange) onChange(path);
  };

  // Coalesce bursts (ng-packagr emits several writes per rebuild) into one flush.
  // Each path keeps the time its first event arrived, so debounceMs is not
  // subtracted from the replay grace window.
  const pending = new Map<string, number>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    for (const [p, at] of pending) deliver(p, at);
    pending.clear();
  };
  const notify = (path: string) => {
    const at = now();
    if (debounceMs <= 0) return deliver(path, at);
    if (!pending.has(path)) pending.set(path, at);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, debounceMs);
    flushTimer.unref?.();
  };

  return {
    addPaths(paths, opts) {
      const list = typeof paths === 'string' ? [paths] : [...paths];
      const shouldPoll = !!opts?.poll;
      const poll = shouldPoll ? { intervalMs: pollIntervalMs } : undefined;
      for (const p of list) {
        if (io.isDirectory(p)) {
          const dir = dirKey(p);
          if (watchers.has(dir) || covers(dir, shouldPoll)) continue;
          try {
            watchers.set(dir, {
              handle: watch(p, { recursive: true, poll }, filename => {
                if (filename) notify(toPosix(join(p, filename)));
              }),
              poll: shouldPoll,
            });
          } catch {
            watchFailed(p);
            continue;
          }
          supersede(dir, shouldPoll);
          continue;
        }

        const key = toPosix(p);
        if (trackedFiles.has(key)) continue;
        trackedFiles.add(key);
        // Seed so the first replay after startup is already recognised as one.
        if (dedupeReplays && !lastSeen.has(key)) {
          const identity = identityOf(key);
          if (identity) lastSeen.set(key, identity);
        }

        // An explicitly watched directory already reports this file recursively.
        if (covers(key, shouldPoll)) continue;
        const dir = dirKey(dirname(p));
        if (fileDirWatchers.has(dir)) continue;
        try {
          fileDirWatchers.set(dir, {
            handle: watch(dir, { recursive: false, poll }, filename => {
              if (!filename) return;
              const changed = toPosix(join(dir, filename));
              if (trackedFiles.has(changed)) notify(changed);
            }),
            poll: shouldPoll,
          });
        } catch {
          watchFailed(dir);
        }
      }
    },

    get: () => dirtyPaths,
    clear: () => dirtyPaths.clear(),
    mutate: fn => fn(dirtyPaths),

    async close() {
      if (flushTimer) clearTimeout(flushTimer);
      for (const { handle } of [...watchers.values(), ...fileDirWatchers.values()]) {
        handle.close();
      }
      watchers.clear();
      fileDirWatchers.clear();
      // Everything below gates work in addPaths, so a re-add after close() has to
      // redo it: reopen the watches, re-seed rather than trust a stale identity, and
      // warn again on the first failure.
      trackedFiles.clear();
      lastSeen.clear();
      watchFailures = 0;
    },
  };
}

interface FileIdentity {
  mtimeMs: number;
  size: number;
}

interface DirWatch {
  handle: WatchHandle;
  /** Polled rather than natively watched, so it also survives inode replacement. */
  poll: boolean;
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
  const files = [...toPaths(sources)].filter(isOutsideNodeModules);
  if (files.length) watcher.addPaths(files);
  if (linkedDirs.length) watcher.addPaths(linkedDirs, { poll: true });
}
