import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { globSync } from 'tinyglobby';
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
  // Only the native variant reports the spelling stored on disk: the JS realpathSync walks the
  // components of the input string and rewrites only the ones that are symlinks.
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
      return {
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
        size: s.size,
        isSymbolicLink: s.isSymbolicLink(),
      };
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
  removeDir(path) {
    // Windows refuses to delete a file an indexer or virus scanner has just opened.
    fs.rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  },
  globFiles(pattern, opts) {
    return globSync(pattern, {
      cwd: opts.cwd,
      ignore: opts.ignore,
      onlyFiles: true,
      deep: Infinity,
      expandDirectories: false,
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

// Stat-scan fallback: ng-packagr's atomic dist rewrites change the inode and
// defeat native fs.watch. Emits changed/added/removed entries relative to `root`.
function pollWatch(
  root: string,
  recursive: boolean,
  intervalMs: number,
  onEvent: (filename: string | null) => void
): WatchHandle {
  const snapshot = (): Map<string, string> => {
    const out = new Map<string, string>();
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
            // mtime alone misses a rewrite within one kernel clock tick (a few ms on ext4), which
            // an atomic replace or a quick second save hits: inode and size settle most of those.
            // Without bigint a Windows ino can be 0 or lossy, which only falls back to size+mtime. On a
            // mount whose inode numbers are not stable (CIFS noserverino) this reports unchanged
            // files; the watcher's replay dedupe drops those.
            const { ino, size, mtimeMs } = fs.statSync(full);
            out.set(path.relative(root, full), `${ino}:${size}:${mtimeMs}`);
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
    for (const [rel, identity] of next) {
      if (prev.get(rel) !== identity) onEvent(rel);
    }
    for (const rel of prev.keys()) {
      if (!next.has(rel)) onEvent(rel);
    }
    prev = next;
  }, intervalMs);
  timer.unref?.();
  return { close: () => clearInterval(timer) };
}
