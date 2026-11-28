import type {
  DenseSharedInfo,
  FederationInfo,
  SharedInfo,
} from '../../domain/core/federation-info.contract.js';
import { inferPackageFromSecondary } from '../../utils/normalize.js';

export type DenseFederationInfo = Omit<FederationInfo, 'shared'> & { shared: DenseSharedInfo[] };

function isDense(entry: SharedInfo | DenseSharedInfo): entry is DenseSharedInfo {
  return 'entries' in entry;
}

/**
 * Groups a flat `shared` array into {@link DenseSharedInfo} objects: one per shared external,
 * with an `entries` map from each import name to its output file. Entries sharing a parent
 * package but with differing metadata split into separate groups. Already-dense entries pass
 * through unchanged.
 */
export function densifyExternals(
  shared: Array<SharedInfo | DenseSharedInfo>,
  declaredPackages: ReadonlyMap<string, string>,
  // An extra grouping key per import name; it splits records but is never written.
  groupKeys: ReadonlyMap<string, string> = new Map()
): DenseSharedInfo[] {
  const result: DenseSharedInfo[] = [];
  const groupIndex = new Map<string, number>();

  for (const entry of shared) {
    if (isDense(entry)) {
      result.push(entry);
      continue;
    }

    const { outFileName, packageName, dev, ...meta } = entry;
    // A declared package publishes one record: its entry points agree, checked before bundling.
    const parent = declaredPackages.get(packageName) ?? inferPackageFromSecondary(packageName);
    // Denylist, so a field added to SharedInfo later splits groups instead of being dropped.
    const sig = JSON.stringify(meta, Object.keys(meta).sort());

    const key = parent + ' ' + (groupKeys.get(packageName) ?? '') + ' ' + sig;

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
      result[existing]!.entries[packageName] = outFileName;
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
