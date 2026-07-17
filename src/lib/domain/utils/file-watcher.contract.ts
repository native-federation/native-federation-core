export interface NfFileWatcherOptions {
  onChange?: (path: string) => void;
  pollIntervalMs?: number;
  debounceMs?: number;
}

interface AddPathsOptions {
  poll?: boolean;
}

export interface NfFileWatcher {
  addPaths(paths: string | readonly string[], opts?: AddPathsOptions): void;
  close(): Promise<void>;
  get(): ReadonlySet<string>;
  clear(): void;
  mutate(fn: (dirtyPaths: Set<string>) => void): void;
}
