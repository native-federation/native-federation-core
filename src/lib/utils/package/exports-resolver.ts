import * as path from 'path';
import { isESMExport } from './esm-detection.js';
import type { ExportEntry, PackageInfo } from '../../domain/utils/package-json.contract.js';

export const NOT_EXPORTED = 'not-exported';
export type NotExported = typeof NOT_EXPORTED;

export function replaceGlob(target: ExportEntry, replacement: string): ExportEntry {
  if (typeof target === 'string') return target.split('*').join(replacement);
  if (target === null || typeof target !== 'object') return target;
  if (Array.isArray(target)) return target.map(t => replaceGlob(t, replacement));
  return Object.entries(target).reduce(
    (a, [k, v]) => ({
      ...a,
      [k]: replaceGlob(v!, replacement),
    }),
    {} as Omit<ExportEntry, string>
  );
}

// see docs/architecture/package-resolution.md#target-selection
export function findOptimalExport(
  target: ExportEntry,
  info: PackageInfo,
  platform: 'browser' | 'node',
  isESM: boolean | undefined = undefined
): PackageInfo | NotExported | undefined {
  if (typeof target === 'string') {
    if (!isValidTarget(target)) return NOT_EXPORTED;
    return {
      ...info,
      entryPoint: path.join(info.entryPoint, target),
      esm: isESM ?? info.esm,
    };
  }
  if (target === null) return NOT_EXPORTED;
  if (target === undefined) return undefined;
  if (typeof target !== 'object') return NOT_EXPORTED;
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const result = findOptimalExport(candidate, info, platform, isESM);
      if (result !== undefined && result !== NOT_EXPORTED) return result;
    }
    return NOT_EXPORTED;
  }

  const exportTypes = Object.keys(target);

  let esmExport: string | undefined;
  if (typeof isESM === 'undefined') {
    esmExport = exportTypes.find(e => isESMExport(e));
    if (esmExport) {
      const result = findOptimalExport(target[esmExport], info, platform, true);
      if (result !== undefined) return result;
    }
  }

  const otherPlatform = platform === 'browser' ? 'node' : 'browser';
  const secondBestEntry =
    'default' in target && target['default']
      ? 'default'
      : exportTypes.filter(e => e !== 'types' && e !== otherPlatform && e !== esmExport)[0];
  const secondBestExport: ExportEntry = target[secondBestEntry!];

  const result = findOptimalExport(
    secondBestExport,
    info,
    platform,
    isESM ?? isESMExport(secondBestEntry!)
  );
  return result === undefined && target['default'] === null ? NOT_EXPORTED : result;
}

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

// see docs/architecture/package-resolution.md#key-matching
export function resolveExportsEntry(exports: ExportEntry, relSecondaryPath: string): ExportEntry {
  if (!exports) return undefined;
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
