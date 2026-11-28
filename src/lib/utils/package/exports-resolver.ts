import * as path from 'path';
import { isESMExport } from './esm-detection.js';
import type { ExportEntry, PackageInfo } from '../../domain/utils/package-json.contract.js';

export function replaceGlob(target: ExportEntry, replacement: string): ExportEntry {
  if (!target) return undefined;
  if (typeof target === 'string') return target.split('*').join(replacement);
  if (Array.isArray(target)) return target.map(t => replaceGlob(t, replacement));
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
  if (Array.isArray(target)) {
    for (const candidate of target) {
      if (typeof candidate === 'string' && !isValidTarget(candidate)) continue;
      const result = findOptimalExport(candidate, info, isESM);
      if (result) return result;
    }
    return undefined;
  }

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

// Node's definition of a valid target: package-relative, never leaving the package.
function isValidTarget(target: string): boolean {
  return (
    target.startsWith('./') &&
    !target
      .slice(2)
      .split(/[\\/]/)
      .some(
        segment => segment === '.' || segment === '..' || segment.toLowerCase() === 'node_modules'
      )
  );
}

// Node's PACKAGE_EXPORTS_RESOLVE key order: an exact key, else the pattern with the longest text
// before `*`, ties to the longer key.
export function resolveExportsEntry(exports: ExportEntry, relSecondaryPath: string): ExportEntry {
  if (!exports) return undefined;
  // A string, an array or an object without subpath keys is the package root's entry.
  if (typeof exports === 'string' || Array.isArray(exports) || !hasSubpathKeys(exports)) {
    exports = { '.': exports };
  }
  if (relSecondaryPath in exports) return exports[relSecondaryPath];

  let bestKey: string | undefined;
  for (const key of Object.keys(exports)) {
    if (!matchesPattern(key, relSecondaryPath)) continue;
    if (bestKey && outranks(bestKey, key)) continue;
    bestKey = key;
  }
  if (!bestKey) return undefined;

  const star = bestKey.indexOf('*');
  const suffixLength = bestKey.length - star - 1;
  return replaceGlob(
    exports[bestKey],
    relSecondaryPath.slice(star, relSecondaryPath.length - suffixLength)
  );
}

function hasSubpathKeys(exports: object): boolean {
  return Object.keys(exports).some(key => key.startsWith('.'));
}

// The matched part is never empty, hence the length check.
function matchesPattern(key: string, subpath: string): boolean {
  const star = key.indexOf('*');
  if (star < 0 || star !== key.lastIndexOf('*')) return false;
  return (
    subpath.length >= key.length &&
    subpath.startsWith(key.slice(0, star)) &&
    subpath.endsWith(key.slice(star + 1))
  );
}

function outranks(a: string, b: string): boolean {
  return (a.indexOf('*') - b.indexOf('*') || a.length - b.length) >= 0;
}
