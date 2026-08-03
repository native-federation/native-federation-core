export interface NfFileWatcherOptions {
  onChange?: (path: string) => void;
  pollIntervalMs?: number;
  debounceMs?: number;
  /** Drop events whose mtime is unchanged since the last one seen for that path.
   *  macOS FSEvents re-delivers 'changed' for recently edited files roughly every
   *  30s; with a watch list of a few thousand sources that replay alone keeps a
   *  rebuild loop awake forever. Default: true. */
  dedupeReplays?: boolean;
  /** Grace period after a path's recorded mtime during which an unchanged-mtime
   *  event still passes. Guards two real-edit cases the equality check would
   *  otherwise swallow: a second save inside one mtime tick (1s granularity on
   *  gRPC-FUSE/NFS/WSL2 drvfs), and an edit landing between the build finishing
   *  and addPaths recording the already-new mtime. Default: 2000. */
  replayGraceMs?: number;
}

interface AddPathsOptions {
  poll?: boolean;
}

export interface NfFileWatcher {
  addPaths(paths: string | readonly string[], opts?: AddPathsOptions): void;
  close(): Promise<void>;
  // Filled for every change, including when `onChange` is set — a listener-only
  // consumer must clear() or the set grows for the process lifetime.
  get(): ReadonlySet<string>;
  clear(): void;
  mutate(fn: (dirtyPaths: Set<string>) => void): void;
}
