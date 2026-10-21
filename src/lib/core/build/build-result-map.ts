import path from 'path';
import type { NFBuildAdapterResult } from '../../domain/core/build-adapter.contract.js';

export function createBuildResultMap(
  buildResult: NFBuildAdapterResult[],
  isHashed: boolean,
  expectedNames: string[] = []
): Record<string, string> {
  const entries = buildResult.some(item => item.entry !== undefined)
    ? claimByEntryField(buildResult)
    : claimByName(buildResult, isHashed, [...new Set(expectedNames.map(n => path.basename(n)))]);

  const claimed = new Set(entries.values());
  const map: Record<string, string> = {};
  for (const item of buildResult) {
    if (!claimed.has(item)) map[path.basename(item.fileName)] = item.fileName;
  }
  for (const [name, item] of entries) map[name] = item.fileName;
  return map;
}

function claimByEntryField(buildResult: NFBuildAdapterResult[]): Map<string, NFBuildAdapterResult> {
  const entries = new Map<string, NFBuildAdapterResult>();
  for (const item of buildResult) {
    if (item.entry === undefined) continue;
    const other = entries.get(item.entry);
    if (other) {
      throw new Error(
        `Build results '${other.fileName}' and '${item.fileName}' both set entry '${item.entry}'.`
      );
    }
    entries.set(item.entry, item);
  }
  return entries;
}

// Longest stem first, so `my-comp-x.js` is never offered to `my`.
function claimByName(
  buildResult: NFBuildAdapterResult[],
  isHashed: boolean,
  expectedNames: string[]
): Map<string, NFBuildAdapterResult> {
  const byName = new Map(buildResult.map(item => [path.basename(item.fileName), item]));
  const entries = new Map<string, NFBuildAdapterResult>();
  const unclaimed = new Set(buildResult);
  const claim = (name: string, item: NFBuildAdapterResult) => {
    entries.set(name, item);
    unclaimed.delete(item);
  };

  for (const name of expectedNames) {
    const exact = byName.get(name);
    if (exact) claim(name, exact);
  }
  if (!isHashed) return entries;

  const pending = expectedNames
    .filter(name => !entries.has(name))
    .sort((a, b) => path.parse(b).name.length - path.parse(a).name.length);
  for (const name of pending) {
    const candidates = [...unclaimed].filter(item =>
      isHashedFormOf(path.basename(item.fileName), name)
    );
    if (candidates.length > 1) {
      throw new Error(
        `The entry point '${path.parse(name).name}' has the same name as other files of the build ` +
          `(${candidates.map(item => path.basename(item.fileName)).join(', ')}). ` +
          `Rename it, or have the adapter set 'entry' on its results.`
      );
    }
    if (candidates[0]) claim(name, candidates[0]);
  }
  return entries;
}

function isHashedFormOf(fileName: string, expectedName: string): boolean {
  const { name: stem, ext } = path.parse(expectedName);
  return (
    fileName.startsWith(`${stem}-`) &&
    fileName.endsWith(ext) &&
    fileName.length > stem.length + 1 + ext.length
  );
}

function requireEntry(map: Record<string, string>, key: string): string {
  const value = map[key];
  if (value === undefined) {
    throw new Error(`No build result found for '${key}'.`);
  }
  return value;
}

/** @deprecated Unused by core; removed in v5. */
export function lookupInResultMap(map: Record<string, string>, requestName: string): string {
  const key = path.basename(requestName);

  // path.basename is to maintain backwards compatible
  return path.basename(requireEntry(map, key));
}

export function popFromResultMap(map: Record<string, string>, requestName: string): string {
  const key = path.basename(requestName);
  const out = requireEntry(map, key);
  delete map[key];
  return out;
}
