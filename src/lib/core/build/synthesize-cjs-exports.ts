import * as path from 'path';
import type { IoPort } from '../../domain/utils/io-port.contract.js';
import type { PackageInfo } from '../../domain/utils/package-json.contract.js';
import { logger } from '../../utils/logger.js';
import { isCjsCandidate } from '../../utils/package/esm-detection.js';
import {
  planCjsWrap,
  buildSyntheticCjsEntry,
  isEsmInteropError,
} from '../../utils/package/cjs-named-exports.js';

/** Evaluates a module at build time (Node `require`) and returns its value, or throws. */
export type ModuleEvaluator = (absPath: string) => unknown;

const SYNTHETIC_DIR = '.nf-cjs-entries';
const warned = new Set<string>();

/** Nearest package.json `type`, walking up from `fromDir` (Node's rule). */
function nearestPackageType(io: IoPort, fromDir: string): 'module' | 'commonjs' | undefined {
  let dir = fromDir;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (io.exists(pkg)) {
      try {
        const type = JSON.parse(io.readText(pkg))?.type;
        return type === 'module' || type === 'commonjs' ? type : undefined;
      } catch {
        // Unparseable: keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * For a CommonJS shared external, `require()`s it, enumerates its runtime named
 * exports, and writes a synthetic ESM entry re-exporting them.
 *
 * Returns the synthetic entry path, or `null` to keep the original entry (not a CJS
 * candidate, no names to wrap, or a `require()` failure → default-only fallback).
 */
export function synthesizeCjsNamedExportsEntry(
  io: IoPort,
  evaluateModule: ModuleEvaluator,
  pi: PackageInfo,
  cachePath: string,
  outName: string
): string | null {
  const entryPoint = pi.entryPoint;

  const candidate = isCjsCandidate({
    esm: pi.esm,
    entryPoint,
    packageType: nearestPackageType(io, path.dirname(entryPoint)),
    readSource: () => io.readText(entryPoint),
  });
  if (!candidate) return null;

  let plan: { wrap: boolean; keys: string[] };
  try {
    plan = planCjsWrap(evaluateModule(entryPoint));
  } catch (err) {
    if (!isEsmInteropError(err) && !warned.has(entryPoint)) {
      warned.add(entryPoint);
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[native-federation] Could not enumerate named exports of "${entryPoint}" at build ` +
          `time (${detail}); falling back to default-only. Named imports from this package ` +
          `may fail across the module boundary.`
      );
    }
    return null;
  }

  if (!plan.wrap) return null;

  const dir = path.join(cachePath, SYNTHETIC_DIR);
  io.mkdirp(dir);
  // Name the synthetic entry after `outName` (version + entry + config hash) so two shared
  // packages whose names normalize to the same identifier can't clobber each other's entry.
  const syntheticPath = path.join(dir, outName);
  io.writeText(syntheticPath, buildSyntheticCjsEntry(entryPoint, plan.keys));
  return syntheticPath;
}
