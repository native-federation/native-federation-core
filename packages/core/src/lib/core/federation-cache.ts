import type { FederationCache } from '../domain/core/federation-cache.contract.js';
import type { ChunkInfo, SharedInfo } from '../domain/core/federation-info.contract.js';

export function createFederationCache(cachePath: string): FederationCache<undefined>;
export function createFederationCache<TBundlerCache>(
  cachePath: string,
  bundlerCache: TBundlerCache
): FederationCache<TBundlerCache>;
export function createFederationCache<TBundlerCache = unknown>(
  cachePath: string,
  bundlerCache?: TBundlerCache
): FederationCache<TBundlerCache> {
  return { externals: [], cachePath, bundlerCache } as FederationCache<TBundlerCache>;
}

export function addExternalsToCache(
  cache: FederationCache,
  { externals, chunks }: { externals: SharedInfo[]; chunks?: ChunkInfo }
) {
  cache.externals.push(...externals);
  if (chunks) {
    if (!cache.chunks) cache.chunks = {};
    cache.chunks = { ...cache.chunks, ...chunks };
  }
}
