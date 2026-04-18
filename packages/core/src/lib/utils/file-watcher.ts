import { logger } from '@softarc/native-federation/internal';
import { watch, statSync, type FSWatcher } from 'fs';
import { join } from 'path';
import type { NfFileWatcher, NfFileWatcherOptions } from '../domain/utils/file-watcher.contract.js';

const toUnix = (p: string) => p.replace(/\\/g, '/');

export function createNfWatcher(options: NfFileWatcherOptions = {}): NfFileWatcher {
  const { onChange } = options;
  const watchers = new Map<string, FSWatcher>();
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
          const isDir = statSync(p).isDirectory();
          const w = isDir
            ? watch(p, { recursive: true }, (_, filename) => {
                if (filename) notify(toUnix(join(p, filename)));
              })
            : watch(p, () => notify(toUnix(p)));
          watchers.set(p, w);
        } catch {
          logger.debug(`Could not watch path '${p}'.`);
        }
      }
    },

    get: () => dirtyPaths,
    clear: () => dirtyPaths.clear(),
    mutate: fn => fn(dirtyPaths),

    async close() {
      for (const w of watchers.values()) {
        w.close();
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
