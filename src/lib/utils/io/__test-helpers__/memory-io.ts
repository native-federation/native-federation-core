import * as crypto from 'crypto';
import * as path from 'path';
import type {
  Digest,
  HashAlgorithm,
  IoPort,
  StatInfo,
  WatchHandle,
} from '../../../domain/utils/io-port.contract.js';

// Hashing uses real `crypto` so tests can assert known digests; `watch` is
// driven manually via `emit`.
export interface MemoryIo extends IoPort {
  setFile(filePath: string, data: string | Uint8Array): MemoryIo;
  setDir(dirPath: string): MemoryIo;
  /** Register `linkPath` as a symlink resolving to `target` (for realpath/stat). */
  setSymlink(linkPath: string, target: string): MemoryIo;
  /** Set an entry's mtime (ms) reported by `stat`. */
  setMtime(filePath: string, mtimeMs: number): MemoryIo;
  files(): string[];
  emit(watchedPath: string, filename?: string | null): void;
}

const toKey = (p: string): string => path.resolve(p).replace(/\\/g, '/');

export function createMemoryIo(): MemoryIo {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const watchers = new Map<string, Array<(filename: string | null) => void>>();
  const symlinks = new Map<string, string>();
  const mtimes = new Map<string, number>();

  const encode = (data: string | Uint8Array): Uint8Array =>
    typeof data === 'string' ? new TextEncoder().encode(data) : data;

  const registerDirs = (key: string) => {
    let dir = path.posix.dirname(key);
    while (dir && dir !== '.' && dir !== path.posix.dirname(dir)) {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  };

  // Segment-aware on purpose: fast-glob only honours '**' as a globstar when it is a whole
  // segment, and a double that lets 'ui-**' span separators hides real pattern bugs.
  const matcher = (pattern: string): RegExp => {
    const segments = pattern.split('/');
    const body = segments
      .map((segment, i) => {
        const last = i === segments.length - 1;
        if (segment === '**') return last ? '(?:[^/]+/)*[^/]+' : '(?:[^/]+/)*';
        const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
        return last ? escaped : escaped + '/';
      })
      .join('');
    return new RegExp('^' + body + '$');
  };

  const resolveOneHop = (key: string): string => {
    for (const [link, target] of symlinks) {
      if (key === link) return target;
      if (key.startsWith(link + '/')) return target + key.slice(link.length);
    }
    return key;
  };

  const io: MemoryIo = {
    setFile(filePath, data) {
      const key = toKey(filePath);
      files.set(key, encode(data));
      registerDirs(key);
      return io;
    },
    setDir(dirPath) {
      dirs.add(toKey(dirPath));
      return io;
    },
    setSymlink(linkPath, target) {
      symlinks.set(toKey(linkPath), toKey(target));
      return io;
    },
    setMtime(filePath, mtimeMs) {
      mtimes.set(toKey(filePath), mtimeMs);
      return io;
    },
    files() {
      return [...files.keys()];
    },
    emit(watchedPath, filename = null) {
      const listeners = watchers.get(toKey(watchedPath));
      if (listeners) for (const fn of listeners) fn(filename);
    },

    readText(p) {
      const bytes = files.get(toKey(p));
      if (!bytes) throw new Error(`ENOENT: ${p}`);
      return new TextDecoder().decode(bytes);
    },
    readBytes(p) {
      const bytes = files.get(toKey(p));
      if (!bytes) throw new Error(`ENOENT: ${p}`);
      return bytes;
    },
    exists(p) {
      const key = toKey(p);
      return files.has(key) || dirs.has(key);
    },
    isFile(p) {
      return files.has(toKey(p));
    },
    isDirectory(p) {
      return dirs.has(toKey(p));
    },
    readDir(p) {
      const key = toKey(p);
      const names = new Set<string>();
      for (const entry of [...files.keys(), ...dirs]) {
        if (path.posix.dirname(entry) === key) names.add(path.posix.basename(entry));
      }
      return [...names];
    },
    realpath(p) {
      // Chained like fs.realpathSync: `npm link` installs two hops
      // (node_modules/x -> <global prefix>/lib/node_modules/x -> <checkout>).
      let key = toKey(p);
      for (let hop = 0; hop < 32; hop++) {
        const next = resolveOneHop(key);
        if (next === key) break;
        key = next;
      }
      return key;
    },
    stat(p): StatInfo | null {
      const key = toKey(p);
      const isSymbolicLink = symlinks.has(key);
      if (!isSymbolicLink && !files.has(key) && !dirs.has(key)) return null;
      return {
        mtimeMs: mtimes.get(key) ?? 0,
        size: files.get(key)?.byteLength ?? 0,
        isSymbolicLink,
      };
    },
    writeText(p, data) {
      const key = toKey(p);
      files.set(key, encode(data));
      registerDirs(key);
    },
    mkdirp(p) {
      const key = toKey(p);
      dirs.add(key);
      registerDirs(key + '/_');
    },
    copyFile(from, to) {
      const bytes = files.get(toKey(from));
      if (!bytes) throw new Error(`ENOENT: ${from}`);
      const key = toKey(to);
      files.set(key, bytes);
      registerDirs(key);
    },
    remove(p) {
      files.delete(toKey(p));
    },
    globFiles(pattern, opts) {
      const cwd = toKey(opts.cwd);
      const re = matcher(pattern);
      const ignored = (opts.ignore ?? []).map(matcher);
      const out: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(cwd + '/')) continue;
        const rel = key.slice(cwd.length + 1);
        if (!re.test(rel)) continue;
        if (ignored.some(i => i.test(rel))) continue;
        out.push(rel);
      }
      return out;
    },
    hash(algorithm: HashAlgorithm, data: Uint8Array | string): Digest {
      const sum = crypto.createHash(algorithm).update(data);
      return {
        hex: () => sum.digest('hex'),
        base64: () => sum.digest('base64'),
      };
    },
    watch(p, _opts, onEvent): WatchHandle {
      const key = toKey(p);
      const list = watchers.get(key) ?? [];
      list.push(onEvent);
      watchers.set(key, list);
      return {
        // Per listener, not per key: two handles can watch one path, and closing
        // one must leave the other delivering as real fs.watch handles do.
        close: () => {
          const remaining = (watchers.get(key) ?? []).filter(fn => fn !== onEvent);
          if (remaining.length) watchers.set(key, remaining);
          else watchers.delete(key);
        },
      };
    },
  };

  return io;
}
