import type { SharedInfo, DenseSharedInfo } from '../../domain/core/federation-info.contract.js';
import { CHUNK_PREFIX } from '../../domain/core/chunk.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';

function isDense(entry: SharedInfo | DenseSharedInfo): entry is DenseSharedInfo {
  return 'entries' in entry;
}

function isFlatChunk(entry: SharedInfo): boolean {
  return entry.packageName.startsWith(CHUNK_PREFIX);
}

/**
 * Groups a flat `shared` array into {@link DenseSharedInfo} objects: one per shared external,
 * with an `entries` map from each import name to its output file. Entries sharing a parent
 * package but with differing metadata split into separate groups. Bundler chunks and
 * already-dense entries pass through unchanged.
 */
export function densifyExternals(
  shared: Array<SharedInfo | DenseSharedInfo>
): Array<SharedInfo | DenseSharedInfo> {
  const result: Array<SharedInfo | DenseSharedInfo> = [];
  const groupIndex = new Map<string, number>();

  for (const entry of shared) {
    if (isDense(entry)) {
      result.push(entry);
      continue;
    }

    if (isFlatChunk(entry)) {
      const { outFileName, ...rest } = entry;
      result.push({ ...rest, entries: { [entry.packageName]: outFileName } });
      continue;
    }

    const parent = inferPackageFromSecondary(entry.packageName);
    const sig = JSON.stringify({
      singleton: entry.singleton,
      strictVersion: entry.strictVersion,
      requiredVersion: entry.requiredVersion,
      version: entry.version,
      shareScope: entry.shareScope,
    });
    const key = parent + ' ' + sig;

    const existing = groupIndex.get(key);
    if (existing === undefined) {
      const dense: DenseSharedInfo = {
        singleton: entry.singleton,
        strictVersion: entry.strictVersion,
        requiredVersion: entry.requiredVersion,
        packageName: parent,
        entries: { [entry.packageName]: entry.outFileName },
      };
      if (entry.version !== undefined) dense.version = entry.version;
      if (entry.shareScope !== undefined) dense.shareScope = entry.shareScope;
      if (entry.bundle !== undefined) dense.bundle = entry.bundle;
      if (entry.dev !== undefined) dense.dev = entry.dev;

      groupIndex.set(key, result.length);
      result.push(dense);
    } else {
      (result[existing] as DenseSharedInfo).entries[entry.packageName] = entry.outFileName;
    }
  }

  return result;
}

export function toDenseSharedInfoFormat(
  shared: Array<SharedInfo | DenseSharedInfo>
): DenseSharedInfo[] {
  return shared.map(external => {
    if ('entries' in external) return external;
    const { outFileName, ...baseSharedInfoProps } = external;
    return {
      ...baseSharedInfoProps,
      entries: { [external.packageName]: outFileName },
    };
  });
}
