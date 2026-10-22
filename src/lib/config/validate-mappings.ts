import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { logger } from '../utils/logger.js';
import { inferPackageFromSecondary } from '../utils/normalize.js';
import { formatList } from '../utils/format-list.js';

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
  throw new Error(
    `Invalid 'shared mappings' config. Only barrel imports can be shared as a sharedMapping: ` +
      `${formatList(invalid, MAX_LISTED)}.`
  );
}

// validate-npm-package-name's rules for new packages: lowercase, no leading '.'/'_', no ~'!()*.
const NPM_NAME = /^(?:@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/;

export function isNpmStylePackage(importName: string): boolean {
  // A wildcard stands in for a name segment and is not itself the offence.
  return NPM_NAME.test(inferPackageFromSecondary(importName.replace(/\*/g, 'x')));
}

// A mapping is published and grouped (`build: 'package'`, denseExternals) by the package
// its import name implies, so a name like '@shared' or '~app/utils' has no sound package to
// group under, unless it declares its package.
export function warnNonNpmMappingNames(
  paths: PathToImport,
  strict = false,
  declaredPackages: ReadonlyMap<string, string> = new Map()
): void {
  const offenders = [
    ...new Set(
      Object.values(paths)
        .filter(importName => !declaredPackages.has(importName) && !isNpmStylePackage(importName))
        .map(inferPackageFromSecondary)
    ),
  ];
  if (offenders.length === 0) return;

  for (const packageName of offenders) {
    logger.warn(
      `Shared mapping '${packageName}' does not follow npm package naming. Name mappings ` +
        `'package' or '@company/package' (lowercase). Subpaths and wildcards ` +
        `('@company/package/*') are allowed, but belong to that package: ` +
        `build: 'package' bundles them together. Or declare the package with 'package' ` +
        `(needs features.denseExternals).`
    );
  }

  if (!strict) return;

  throw new Error(
    `Invalid 'shared mappings' config. Shared mappings must follow npm package naming ` +
      `('package' or '@company/package', subpaths belong to that package): ` +
      `${formatList(offenders, MAX_LISTED)}.`
  );
}
