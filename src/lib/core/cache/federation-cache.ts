import type { FederationCache } from '../../domain/core/federation-cache.contract.js';
import type {
  ArtifactInfo,
  OutputFile,
  SharedBundleResult,
} from '../../domain/core/federation-info.contract.js';

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
  bundleName: string,
  { externals, chunks, integrity, outputFiles }: SharedBundleResult
) {
  cache.externals.push(...externals);
  cache.externalFiles = { ...cache.externalFiles, [bundleName]: outputFiles };
  if (chunks) {
    if (!cache.chunks) cache.chunks = {};
    cache.chunks = { ...cache.chunks, ...chunks };
  }
  if (integrity) {
    if (!cache.integrity) cache.integrity = {};
    cache.integrity = { ...cache.integrity, ...integrity };
  }
}

// Replaced, never merged: a rebuild's chunks need not keep their names, and stale ones stay on disk.
export function recordArtifactFiles(cache: FederationCache, artifactInfo: ArtifactInfo): void {
  cache.artifactFiles = artifactInfo.outputFiles ?? [];
}

export function collectOutputFiles(cache: FederationCache): OutputFile[] {
  const byName = new Map<string, OutputFile>();
  for (const file of [
    ...Object.values(cache.externalFiles ?? {}).flat(),
    ...(cache.artifactFiles ?? []),
  ]) {
    // Bundles write flat into one folder, so two that emit the same content-named chunk share one
    // file. 'browser' wins: the browser can load it, so a built-in it imports is a real break.
    if (byName.get(file.fileName)?.platform !== 'browser') byName.set(file.fileName, file);
  }
  return [...byName.values()];
}
