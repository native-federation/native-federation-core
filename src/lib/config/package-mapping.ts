import * as path from 'path';
import { findOptimalExport, resolveExportsEntry } from '../utils/package/exports-resolver.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import type { ExportEntry } from '../domain/utils/package-json.contract.js';
import { logger } from '../utils/logger.js';

interface PackageManifest {
  exports?: Record<string, ExportEntry>;
  module?: string;
  main?: string;
  type?: string;
}

/**
 * A mapping may point at a built package instead of a source barrel — `"@org/ui": ["dist/ui"]`
 * rather than `["libs/ui/src/public-api.ts"]`. That shape is what keeps ngtsc from emitting deep
 * relative imports into a mapped library (see docs/research.md), so the pipeline has to handle a
 * directory where it otherwise expects a file.
 *
 * The awkward part is that one package has two entry points and each half of the build resolves a
 * different one: TypeScript lands on `types/ui.d.ts`, esbuild on `fesm2022/ui.mjs`. Neither is
 * the mapping's identity — the package directory is — so matching is containment-based and the
 * runtime entry is resolved only where a bundler entry point is actually needed.
 */
export function isPackageMapping(io: FileReaderPort, mappedPath: string): boolean {
  return io.isDirectory(mappedPath) && io.isFile(path.join(mappedPath, 'package.json'));
}

/** Cheap memo: the predicate runs per candidate import, the answer is per mapping. */
export function createPackageMappingPredicate(io: FileReaderPort): (p: string) => boolean {
  const cache = new Map<string, boolean>();
  return (mappedPath: string) => {
    let hit = cache.get(mappedPath);
    if (hit === undefined) {
      hit = isPackageMapping(io, mappedPath);
      cache.set(mappedPath, hit);
    }
    return hit;
  };
}

/**
 * The file a bundler should treat as the package's entry point, preferring ESM. Returns null when
 * the manifest names nothing usable, which the caller reports against the mapping rather than
 * failing the build on a directory the bundler would reject with a confusing message.
 */
export function resolvePackageMappingEntry(io: FileReaderPort, packageDir: string): string | null {
  const manifestPath = path.join(packageDir, 'package.json');
  if (!io.isFile(manifestPath)) return null;

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(io.readText(manifestPath));
  } catch (err: unknown) {
    logger.warn(`[sharedMappings] Failed to parse ${manifestPath}: ${(err as Error).message}`);
    return null;
  }

  const exportsEntry = resolveExportsEntry(manifest.exports, '.');
  if (exportsEntry) {
    const resolved = findOptimalExport(exportsEntry, {
      entryPoint: packageDir,
      packageName: '',
      version: '',
      esm: manifest.type === 'module',
    });
    if (resolved && io.isFile(resolved.entryPoint)) return resolved.entryPoint;
  }

  for (const field of ['module', 'main'] as const) {
    const value = manifest[field];
    if (typeof value !== 'string') continue;
    const candidate = path.join(packageDir, value);
    if (io.isFile(candidate)) return candidate;
  }

  return null;
}
