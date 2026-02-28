import type { ChunkInfo, SharedInfo } from './federation-info.contract.js';

export type FederationCache<TBundlerCache = unknown> = {
  externals: SharedInfo[];
  chunks?: ChunkInfo;
  bundlerCache: TBundlerCache;
  cachePath: string;
};
