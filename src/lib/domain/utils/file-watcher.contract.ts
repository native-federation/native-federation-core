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
  // Filled for every change, including when `onChange` is set — a listener-only
  // consumer must clear() or the set grows for the process lifetime.
  get(): ReadonlySet<string>;
  clear(): void;
  mutate(fn: (dirtyPaths: Set<string>) => void): void;
}
