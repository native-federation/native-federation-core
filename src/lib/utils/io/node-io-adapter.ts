import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import type {
  Digest,
  HashAlgorithm,
  IoPort,
  StatInfo,
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
  realpath(path) {
    try {
      return fs.realpathSync(path);
    } catch {
      return path;
    }
  },
  // The JS realpathSync walks the components of the *input string* and only rewrites the
  // ones that are symlinks, so it preserves the caller's casing. Only the native variant
  // goes to the filesystem for the stored spelling.
  realpathNative(path) {
    try {
      return fs.realpathSync.native(path);
    } catch {
      return path;
    }
  },
  stat(path): StatInfo | null {
    try {
      const s = fs.lstatSync(path);
      return { mtimeMs: s.mtimeMs, size: s.size, isSymbolicLink: s.isSymbolicLink() };
    } catch {
      return null;
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
    return fg.sync(pattern, {
      cwd: opts.cwd,
      ignore: opts.ignore,
      onlyFiles: true,
      deep: Infinity,
    });
  },
  hash(algorithm: HashAlgorithm, data: Uint8Array | string): Digest {
    const sum = crypto.createHash(algorithm).update(data);
    return {
      hex: () => sum.digest('hex'),
      base64: () => sum.digest('base64'),
    };
  },
  watch(watchPath, opts, onEvent): WatchHandle {
    if (opts.poll) return pollWatch(watchPath, opts.recursive, opts.poll.intervalMs, onEvent);
    const watcher = fs.watch(watchPath, { recursive: opts.recursive }, (_event, filename) =>
      onEvent(filename ? filename.toString() : null)
    );
    return { close: () => watcher.close() };
  },
};

// mtime-scan fallback: ng-packagr's atomic dist rewrites change the inode and
// defeat native fs.watch. Emits changed/added/removed entries relative to `root`.
function pollWatch(
  root: string,
  recursive: boolean,
  intervalMs: number,
  onEvent: (filename: string | null) => void
): WatchHandle {
  const snapshot = (): Map<string, number> => {
    const out = new Map<string, number>();
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        // `npm link` points at the package root, so without this the snapshot walks the
        // linked lib's own deps — enough to outrun the interval and starve the loop.
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) walk(full);
        } else {
          try {
            out.set(path.relative(root, full), fs.statSync(full).mtimeMs);
          } catch {
            /* vanished between readdir and stat */
          }
        }
      }
    };
    walk(root);
    return out;
  };

  let prev = snapshot();
  const timer = setInterval(() => {
    const next = snapshot();
    for (const [rel, mtime] of next) {
      if (prev.get(rel) !== mtime) onEvent(rel);
    }
    for (const rel of prev.keys()) {
      if (!next.has(rel)) onEvent(rel);
    }
    prev = next;
  }, intervalMs);
  timer.unref?.();
  return { close: () => clearInterval(timer) };
}
