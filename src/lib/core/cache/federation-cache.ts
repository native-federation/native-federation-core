import type { FederationCache } from '../../domain/core/federation-cache.contract.js';
import type { ArtifactInfo, OutputFile } from '../../domain/core/federation-info.contract.js';
import type { SharedBundleResult } from '../build/bundle-shared.js';

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

type ExternalsState = Pick<FederationCache, 'externals' | 'chunks' | 'integrity' | 'externalFiles'>;

const pickExternals = ({ externals, chunks, integrity, externalFiles }: ExternalsState) => ({
  externals,
  chunks,
  integrity,
  externalFiles,
});

const emptyExternals = (): ExternalsState => ({
  externals: [],
  chunks: undefined,
  integrity: undefined,
  externalFiles: undefined,
});

// The bundles add to a staged copy, written back in one assignment only once all of them ran, so a
// failed or aborted run leaves the last complete externals in place. Until then the run is marked
// incomplete: one that cleared a bundle's disk cache and then failed must not be skipped next time.
export async function withStagedExternals(
  cache: FederationCache,
  run: (staged: FederationCache) => Promise<void>
): Promise<void> {
  cache.sharedRunIncomplete = true;
  const staged: FederationCache = { ...cache, ...emptyExternals() };
  await run(staged);
  Object.assign(cache, pickExternals(staged));
  cache.sharedRunIncomplete = false;
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
