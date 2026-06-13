import type { ChunkInfo, IntegrityMap, SharedInfo } from './federation-info.contract.js';

export type FederationCache<TBundlerCache = unknown> = {
  externals: SharedInfo[];
  chunks?: ChunkInfo;
  integrity?: IntegrityMap;
  bundlerCache: TBundlerCache;
  cachePath: string;
};
