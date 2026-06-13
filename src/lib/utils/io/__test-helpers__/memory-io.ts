import * as crypto from 'crypto';
import * as path from 'path';
import type {
  Digest,
  HashAlgorithm,
  IoPort,
  WatchHandle,
} from '../../../domain/utils/io-port.contract.js';

// Hashing uses real `crypto` so tests can assert known digests; `watch` is
// driven manually via `emit`.
export interface MemoryIo extends IoPort {
  setFile(filePath: string, data: string | Uint8Array): MemoryIo;
  setDir(dirPath: string): MemoryIo;
  files(): string[];
  emit(watchedPath: string, filename?: string | null): void;
}

const toKey = (p: string): string => path.resolve(p).replace(/\\/g, '/');

// Unicode noncharacter placeholder, so the single-`*` replacement does not
// re-process a `*` we just emitted. Cannot appear in a real path.
const ANY = '￿';

export function createMemoryIo(): MemoryIo {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const watchers = new Map<string, Array<(filename: string | null) => void>>();

  const encode = (data: string | Uint8Array): Uint8Array =>
    typeof data === 'string' ? new TextEncoder().encode(data) : data;

  const registerDirs = (key: string) => {
    let dir = path.posix.dirname(key);
    while (dir && dir !== '.' && dir !== path.posix.dirname(dir)) {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  };

  const matcher = (pattern: string): RegExp => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const body = escaped
      .replace(/\*\*\/\*/g, ANY)
      .replace(/\*\*/g, ANY)
      .replace(/\*/g, '[^/]*')
      .split(ANY)
      .join('.*');
    return new RegExp('^' + body + '$');
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
      const out: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(cwd + '/')) continue;
        const rel = key.slice(cwd.length + 1);
        if (re.test(rel)) out.push(rel);
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
        close: () => {
          watchers.delete(key);
        },
      };
    },
  };

  return io;
}
