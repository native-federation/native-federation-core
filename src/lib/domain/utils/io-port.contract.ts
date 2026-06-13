// Filesystem / crypto / glob abstraction. Utils depend on these small,
// segregated ports rather than `fs`/`crypto`/`fast-glob` directly, so they can
// be unit-tested with in-memory fakes (see ../../utils/io/).

export type HashAlgorithm = 'md5' | 'sha256' | 'sha384' | 'sha512';

export interface Digest {
  hex(): string;
  base64(): string;
}

export interface FileReaderPort {
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  exists(path: string): boolean;
  /** False on ENOENT, never throws. */
  isFile(path: string): boolean;
  /** False on ENOENT, never throws. */
  isDirectory(path: string): boolean;
  /** Immediate child entry names (not full paths). Empty array on ENOENT, never throws. */
  readDir(path: string): string[];
}

export interface FileWriterPort {
  writeText(path: string, data: string): void;
  /** Create a directory and any missing parents. */
  mkdirp(path: string): void;
  copyFile(from: string, to: string): void;
  remove(path: string): void;
}

export interface GlobPort {
  globFiles(pattern: string, opts: { cwd: string }): string[];
}

export interface HashPort {
  hash(algorithm: HashAlgorithm, data: Uint8Array | string): Digest;
}

export interface WatchHandle {
  close(): void;
}

export interface WatchPort {
  /**
   * For a recursive directory watch `onEvent` receives the changed entry's
   * filename relative to `path`; for a file it receives the path itself (or
   * null when the platform omits it).
   */
  watch(
    path: string,
    opts: { recursive: boolean },
    onEvent: (filename: string | null) => void
  ): WatchHandle;
}

export interface IoPort
  extends FileReaderPort,
    FileWriterPort,
    GlobPort,
    HashPort,
    WatchPort {}
