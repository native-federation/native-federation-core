import type {
  ChunkInfo,
  IntegrityMap,
  OutputFile,
  SharedInfo,
} from './federation-info.contract.js';

export type FederationCache<TBundlerCache = unknown> = {
  externals: SharedInfo[];
  chunks?: ChunkInfo;
  integrity?: IntegrityMap;
  // Keyed by bundle name, so re-running a bundle replaces its files instead of adding them again.
  externalFiles?: Record<string, OutputFile[]>;
  // Replaced on every build, never merged.
  artifactFiles?: OutputFile[];
  // Core-owned: set while a shared bundle run is in flight, and left set when it fails.
  sharedRunIncomplete?: boolean;
  bundlerCache: TBundlerCache;
  cachePath: string;
};
