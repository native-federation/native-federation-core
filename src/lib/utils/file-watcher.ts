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
  options: NfFileWatcherOptions = {}
): NfFileWatcher {
  const { onChange } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const debounceMs = options.debounceMs ?? 0;
  const watchers = new Map<string, WatchHandle>();
  const dirtyPaths = new Set<string>();

  const deliver = (path: string) => {
    if (onChange) onChange(path);
    else dirtyPaths.add(path);
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
        try {
          const handle = io.isDirectory(p)
            ? io.watch(p, { recursive: true, poll }, filename => {
                if (filename) notify(toPosix(join(p, filename)));
              })
            : io.watch(p, { recursive: false, poll }, () => notify(toPosix(p)));
          watchers.set(p, handle);
        } catch {
          logger.debug(`Could not watch path '${p}'.`);
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

export function syncNfFileWatcher(
  watcher: NfFileWatcher,
  bundlerCache: { keys(): IterableIterator<string> },
  // Realpath'd dirs of symlinked (npm-linked) shared packages — watched despite
  // living under node_modules. See core's `linkedSharedDirs`.
  linkedDirs: readonly string[] = []
): void {
  const files = [...bundlerCache.keys()].filter(k => !k.includes('node_modules'));
  if (files.length) watcher.addPaths(files);
  if (linkedDirs.length) watcher.addPaths(linkedDirs, { poll: true });
}
