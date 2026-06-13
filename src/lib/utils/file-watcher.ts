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
  const watchers = new Map<string, WatchHandle>();
  const dirtyPaths = new Set<string>();

  const notify = (path: string) => {
    if (onChange) onChange(path);
    else dirtyPaths.add(path);
  };

  return {
    addPaths(paths) {
      const list = typeof paths === 'string' ? [paths] : [...paths];
      for (const p of list) {
        if (watchers.has(p)) continue;
        try {
          const isDir = io.isDirectory(p);
          const handle = isDir
            ? io.watch(p, { recursive: true }, filename => {
                if (filename) notify(toPosix(join(p, filename)));
              })
            : io.watch(p, { recursive: false }, () => notify(toPosix(p)));
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
      for (const handle of watchers.values()) {
        handle.close();
      }
      watchers.clear();
    },
  };
}

export function syncNfFileWatcher(
  watcher: NfFileWatcher,
  bundlerCache: { keys(): IterableIterator<string> }
): void {
  const files = [...bundlerCache.keys()].filter(k => !k.includes('node_modules'));
  if (files.length) watcher.addPaths(files);
}
