import type { WatchPort } from './io-port.contract.js';

export interface NfFileWatcherOptions {
  /** Watch implementation, defaulting to Node's fs. The built-in poll is dependency-free
   *  but sweeps the tree every `pollIntervalMs`; a host that already ships a real watcher
   *  should pass it here. An event-driven implementation may ignore `opts.poll`, but must
   *  then survive inode replacement on its own: a polled dir supersedes the native watches
   *  beneath it, so a missed rename-replace is never re-covered. */
  watch?: WatchPort['watch'];
  onChange?: (path: string) => void;
  pollIntervalMs?: number;
  debounceMs?: number;
  /** Drop events whose mtime is unchanged since the last one seen for that path.
   *  macOS FSEvents re-delivers 'changed' for recently edited files roughly every
   *  30s; with a watch list of a few thousand sources that replay alone keeps a
   *  rebuild loop awake forever. Default: true. */
  dedupeReplays?: boolean;
  /** Grace period after a path's recorded mtime during which an event whose mtime
   *  and byte length both match still passes, covering a second save inside one
   *  mtime tick. The 2000 default is twice the coarsest mtime granularity in play
   *  (1s on gRPC-FUSE/NFS/WSL2 drvfs/HFS+); raise it for a filesystem coarser than
   *  that, or for a network mount whose server clock runs behind the client.
   *  See AGENTS.md "Replay dedupe". Default: 2000. */
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
