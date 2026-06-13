import * as path from 'path';
import { isESMExport } from './esm-detection.js';
import type {
  ExportEntry,
  PackageInfo,
} from '../../domain/utils/package-json.contract.js';

export function replaceGlob(target: ExportEntry, replacement: string): ExportEntry {
  if (!target) return undefined;
  if (typeof target === 'string') return target.replace('*', replacement);
  return Object.entries(target).reduce(
    (a, [k, v]) => ({
      ...a,
      [k]: replaceGlob(v!, replacement),
    }),
    {} as Omit<ExportEntry, string>
  );
}

/**
 * Walk an `exports` entry (string, conditions object, or array) to the single
 * best target, preferring ESM. Returns a {@link PackageInfo} with `entryPoint`
 * resolved relative to `info.entryPoint`, or `undefined` when nothing resolves.
 */
export function findOptimalExport(
  target: ExportEntry,
  info: PackageInfo,
  isESM: boolean | undefined = undefined
): PackageInfo | undefined {
  if (typeof target === 'string') {
    return {
      ...info,
      entryPoint: path.join(info.entryPoint, target),
      esm: isESM ?? info.esm,
    };
  }
  if (!target) return undefined;
  if (Array.isArray(target)) return findOptimalExport(target[0], info, isESM);

  const exportTypes = Object.keys(target);

  if (typeof isESM === 'undefined') {
    const esmExport = exportTypes.find(e => isESMExport(e));
    if (esmExport) {
      return findOptimalExport(target[esmExport], info, true);
    }
  }

  const secondBestEntry =
    'default' in target && target['default']
      ? 'default'
      : exportTypes.filter(e => e !== 'types')[0];
  const secondBestExport: ExportEntry = target[secondBestEntry!];

  return findOptimalExport(secondBestExport, info, isESM ?? isESMExport(secondBestEntry!));
}

/**
 * Find the `exports` field entry matching a secondary subpath (e.g. `./sub`),
 * expanding subpath-pattern (`*`) entries. Returns `undefined` when no key matches.
 */
export function resolveExportsEntry(
  exports: Record<string, ExportEntry> | undefined,
  relSecondaryPath: string
): ExportEntry {
  const exportsKey = Object.keys(exports ?? {}).find(e => {
    if (e === relSecondaryPath) return true;
    if (e === './*') return true;
    if (!e.endsWith('*')) return false;
    const globPath = e.substring(0, e.length - 1);
    return relSecondaryPath.startsWith(globPath);
  });

  if (!exportsKey || !exports) return undefined;

  let entry = exports[exportsKey];
  if (exportsKey.endsWith('*')) {
    const replacement = relSecondaryPath.substring(exportsKey.length - 1);
    entry = replaceGlob(entry, replacement);
  }
  return entry;
}
