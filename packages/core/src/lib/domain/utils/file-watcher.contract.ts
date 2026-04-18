export interface NfFileWatcherOptions {
  onChange?: (path: string) => void;
}

export interface NfFileWatcher {
  addPaths(paths: string | readonly string[]): void;
  close(): Promise<void>;
  get(): ReadonlySet<string>;
  clear(): void;
  mutate(fn: (dirtyPaths: Set<string>) => void): void;
}
