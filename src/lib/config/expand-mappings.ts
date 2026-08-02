import * as path from 'path';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { GlobPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { resolveMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import { isModuleFile, matchMapping } from './match-mapping.js';
import { isNonBarrelImport } from './validate-mappings.js';
import { parseWildcard, toPosix } from '../utils/path-patterns.js';
import { logger } from '../utils/logger.js';

export interface MappingExpansionContext {
  io: GlobPort;
  workspaceRoot: string;
}

export function isWildcardMapping(mappedPath: string, mappedImport: string): boolean {
  return mappedPath.includes('*') || mappedImport.includes('*');
}

/**
 * Turns a wildcard mapping into the concrete entry points it stands for. A path containing a
 * wildcard segment is not something the bundler can resolve, so it has to be walked on disk;
 * the reachability pass is the only other thing that can materialise one.
 *
 * Naming goes through `matchMapping`, the same rule reachability uses, so an entry point is
 * never advertised under a specifier the other path would not have produced. The glob is a
 * guess about what consumers import, so it only yields entry-point-shaped specifiers; anything
 * genuinely deep-imported is added by the reachability walk, which has the evidence.
 */
export function expandWildcardMapping(
  mappedPath: string,
  mappedImport: string,
  ctx: MappingExpansionContext
): PathToImport {
  const pattern = parseWildcard(toPosix(path.relative(ctx.workspaceRoot, mappedPath)));
  if (!pattern.hasWildcard) {
    logger.warn(`Mapping '${mappedImport}' has no wildcard to expand and was not shared.`);
    return {};
  }

  // fast-glob needs **/* to match files at any depth; a tsconfig '*' spans separators too.
  const files = ctx.io.globFiles(pattern.prefix + '**/*' + pattern.suffix, {
    cwd: ctx.workspaceRoot,
  });

  const expanded: PathToImport = {};
  const takenBy: Record<string, string> = {};
  const collisions: string[] = [];
  const notEntryPoints: string[] = [];

  for (const file of files) {
    if (!isModuleFile(file)) continue;

    const absPath = path.join(ctx.workspaceRoot, toPosix(file).replace(/^\.\//, ''));
    const importName = matchMapping(absPath, { [mappedPath]: mappedImport });
    if (!importName) continue;

    if (isNonBarrelImport(importName)) {
      notEntryPoints.push(importName);
      continue;
    }

    // Two files can resolve to one specifier ('x.ts' and 'x/index.ts'); advertising both
    // would put duplicate keys in the import map, so the first wins.
    if (takenBy[importName]) {
      collisions.push(`${importName} (${absPath}, kept ${takenBy[importName]})`);
      continue;
    }

    takenBy[importName] = absPath;
    expanded[absPath] = importName;
  }

  if (notEntryPoints.length > 0) {
    logger.debug(
      `Mapping '${mappedImport}' skipped ${notEntryPoints.length} match(es) that are not entry points: ${notEntryPoints.join(', ')}.`
    );
  }

  if (collisions.length > 0) {
    logger.warn(
      `Mapping '${mappedImport}' expanded to duplicate imports; extra matches dropped: ${collisions.join(', ')}.`
    );
  }

  if (Object.keys(expanded).length === 0) {
    logger.warn(
      notEntryPoints.length > 0
        ? `Mapping '${mappedImport}' matched only implementation files, no entry points, and was not shared.`
        : `Mapping '${mappedImport}' matched no files on disk and was not shared.`
    );
  }

  return expanded;
}

/**
 * The `ignoreUnusedDeps: false` path: nothing is pruned, but wildcard mappings still have to
 * become real entry points, and only `resolveGlob` can do that here.
 */
export function expandOrDropWildcards(
  config: NormalizedFederationConfig,
  ctx: MappingExpansionContext
): PathToImport {
  const result: PathToImport = {};
  const dropped: string[] = [];

  for (const [mappedPath, mappedImport] of Object.entries(config.sharedMappings)) {
    if (!isWildcardMapping(mappedPath, mappedImport)) {
      result[mappedPath] = mappedImport;
      continue;
    }

    const mappingConfig = resolveMappingConfig(
      mappedImport,
      config.sharedMappingsConfig,
      config.features.mappingVersion
    );
    if (mappingConfig.resolveGlob) {
      Object.assign(result, expandWildcardMapping(mappedPath, mappedImport, ctx));
      continue;
    }

    dropped.push(mappedImport);
  }

  if (dropped.length > 0) {
    logger.warn(
      `Sharing mapped paths with wildcards (*) needs either the ignoreUnusedDeps feature or 'includeSecondaries: { resolveGlob: true }'. Dropped: ${dropped.join(', ')}.`
    );
  }

  return withoutSkippedMappings(result, config.skip);
}
