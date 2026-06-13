import * as fs from 'fs';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import type {
  Digest,
  HashAlgorithm,
  IoPort,
  WatchHandle,
} from '../../domain/utils/io-port.contract.js';

export const nodeIo: IoPort = {
  readText(path) {
    return fs.readFileSync(path, 'utf-8');
  },
  readBytes(path) {
    return fs.readFileSync(path);
  },
  exists(path) {
    return fs.existsSync(path);
  },
  isFile(path) {
    try {
      return fs.statSync(path).isFile();
    } catch {
      return false;
    }
  },
  isDirectory(path) {
    try {
      return fs.statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readDir(path) {
    try {
      return fs.readdirSync(path);
    } catch {
      return [];
    }
  },
  writeText(path, data) {
    fs.writeFileSync(path, data, 'utf-8');
  },
  mkdirp(path) {
    fs.mkdirSync(path, { recursive: true });
  },
  copyFile(from, to) {
    fs.copyFileSync(from, to);
  },
  remove(path) {
    fs.unlinkSync(path);
  },
  globFiles(pattern, opts) {
    return fg.sync(pattern, { cwd: opts.cwd, onlyFiles: true, deep: Infinity });
  },
  hash(algorithm: HashAlgorithm, data: Uint8Array | string): Digest {
    const sum = crypto.createHash(algorithm).update(data);
    return {
      hex: () => sum.digest('hex'),
      base64: () => sum.digest('base64'),
    };
  },
  watch(path, opts, onEvent): WatchHandle {
    const watcher = opts.recursive
      ? fs.watch(path, { recursive: true }, (_event, filename) =>
          onEvent(filename ? filename.toString() : null)
        )
      : fs.watch(path, () => onEvent(path));
    return { close: () => watcher.close() };
  },
};
