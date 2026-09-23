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

    const { outFileName, packageName, dev, ...meta } = entry;
    const parent = inferPackageFromSecondary(packageName);
    // Denylist, so a field added to SharedInfo later splits groups instead of being dropped.
    const sig = JSON.stringify(meta, Object.keys(meta).sort());
    const key = parent + ' ' + sig;

    const existing = groupIndex.get(key);
    if (existing === undefined) {
      const dense: DenseSharedInfo = {
        ...meta,
        packageName: parent,
        entries: { [packageName]: outFileName },
      };
      if (dev !== undefined) dense.dev = dev;

      groupIndex.set(key, result.length);
      result.push(dense);
    } else {
      (result[existing] as DenseSharedInfo).entries[packageName] = outFileName;
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
