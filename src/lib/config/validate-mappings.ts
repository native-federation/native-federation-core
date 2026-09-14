import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { logger } from '../utils/logger.js';

/**
 * A trailing `.js`/`.ts`/... is a file import and resolves; any other dot in the last segment
 * (`helper.service`, `lib.v2`) does not. Kept identical to the Angular adapter's
 * `checkForInvalidImports` so the two cannot disagree about what is shareable.
 */
const IMPORTABLE_EXTENSIONS = new Set(['mjs', 'js', 'mts', 'ts', 'jsx', 'tsx', 'json']);

/** Offenders named in the thrown message; the warnings enumerate all of them. */
const MAX_LISTED = 5;

/**
 * A mapped path is advertised under its import specifier and marked external, so the specifier
 * has to be one a browser import map can resolve. Only barrel-shaped specifiers are: a dot in
 * the last segment breaks resolution, see https://github.com/vitejs/vite/issues/21036.
 */
export function isNonBarrelImport(importName: string): boolean {
  if (!importName.includes('.')) return false;

  const queryIndex = importName.search(/[?#]/);
  const sanitized = queryIndex >= 0 ? importName.slice(0, queryIndex) : importName;

  const lastSegment = sanitized.slice(sanitized.lastIndexOf('/') + 1);
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex < 0) return false;

  return !IMPORTABLE_EXTENSIONS.has(lastSegment.slice(dotIndex + 1));
}

/**
 * Runs on the final mapping set, which is exactly what gets advertised in `remoteEntry.json`.
 * Anything still here will be published and resolved from an import map, so a specifier that
 * cannot be resolved is a build error. Sources that legitimately decline to share — pruning,
 * and the `resolveGlob` guess — have already dropped their non-barrel candidates by now, so
 * this never fires for a path nobody asked to publish.
 */
export function assertBarrelMappings(paths: PathToImport): void {
  const invalid = Object.values(paths).filter(isNonBarrelImport);
  if (invalid.length === 0) return;

  for (const importName of invalid) {
    logger.warn(`Only barrel imports can be shared as a sharedMapping: '${importName}'.`);
  }

  // The warnings above already name every offender; keep the thrown message readable.
  const shown = invalid.slice(0, MAX_LISTED).map(i => `'${i}'`).join(', ');
  const rest = invalid.length - MAX_LISTED;

  throw new Error(
    `Invalid 'shared mappings' config. Only barrel imports can be shared as a sharedMapping: ` +
      `${shown}${rest > 0 ? ` and ${rest} more` : ''}.`
  );
}

/**
 * Turns sheriff's `SH-001: invalid path mapping detected` into a message that names the library
 * and says what to do. Called only from the reachability scan's failure path, so it never changes
 * *when* a build fails — a mapping nobody reaches is still pruned rather than rejected.
 *
 * A mapping onto build output goes missing far more often than one onto source: a fresh clone, a
 * cleaned `dist`, or an app built before the library it depends on all produce it.
 *
 * Returns normally when nothing here explains the failure, leaving the original error to surface.
 */
export function explainMissingMappedPath(io: FileReaderPort, paths: PathToImport): void {
  const missing = Object.entries(paths).filter(
    // A wildcard path is a pattern, not a location; it only becomes real once expanded.
    ([mappedPath]) => !mappedPath.includes('*') && !io.exists(mappedPath)
  );
  if (missing.length === 0) return;

  for (const [mappedPath, importName] of missing) {
    logger.warn(`Shared mapping '${importName}' points at '${mappedPath}', which does not exist.`);
  }

  const [firstPath, firstImport] = missing[0]!;
  const rest = missing.length - 1;

  throw new Error(
    `Shared mapping '${firstImport}' points at '${firstPath}', which does not exist` +
      `${rest > 0 ? ` (and ${rest} other mapping${rest > 1 ? 's' : ''})` : ''}. ` +
      `If this mapping points at a library's build output, build that library before the app.`
  );
}

/**
 * The `prebuiltMappings` guarantee: every mapping resolves to a built package, never to source.
 * Opt-in, because a mapping is not always a library — an alias onto a single app file
 * (`'@app/env': ['src/environments/environment.ts']`) has nothing to build, and with
 * `sharedMappings` unset every tsconfig path becomes a mapping.
 *
 * What it catches is drift: a mapping quietly reverted to source keeps building, and the
 * duplicate-evaluation it reintroduces only shows up at runtime.
 */
export function assertPrebuiltMappings(
  paths: PathToImport,
  isPackage: (mappedPath: string) => boolean
): void {
  const fromSource = Object.entries(paths).filter(([mappedPath]) => !isPackage(mappedPath));
  if (fromSource.length === 0) return;

  for (const [mappedPath, importName] of fromSource) {
    logger.warn(`Shared mapping '${importName}' resolves to source at '${mappedPath}'.`);
  }

  const shown = fromSource.slice(0, MAX_LISTED).map(([, i]) => `'${i}'`).join(', ');
  const rest = fromSource.length - MAX_LISTED;

  throw new Error(
    `The 'prebuiltMappings' feature requires every shared mapping to point at a built package ` +
      `(a directory containing a package.json). These point at source: ${shown}` +
      `${rest > 0 ? ` and ${rest} more` : ''}.`
  );
}
