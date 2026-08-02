import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
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
