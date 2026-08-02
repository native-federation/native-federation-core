import * as path from 'path';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { IncludeSecondariesOptions } from '../domain/config/external-config.contract.js';
import type { GlobPort } from '../domain/utils/io-port.contract.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { resolveMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import { resolvePackageJsonExportsWildcardCore } from '../utils/package/resolve-wildcard-keys.js';
import { toPosix } from '../utils/path-patterns.js';
import { logger } from '../utils/logger.js';

export interface MappingExpansionContext {
  io: GlobPort;
  workspaceRoot: string;
}

export function isWildcardMapping(mappedPath: string, mappedImport: string): boolean {
  return mappedPath.includes('*') || mappedImport.includes('*');
}

export function resolvesGlob(includeSecondaries: IncludeSecondariesOptions | undefined): boolean {
  return typeof includeSecondaries === 'object' && !!includeSecondaries.resolveGlob;
}

/**
 * A mapped path has no secondary entry points, so a bare `includeSecondaries: true` says nothing
 * about it and is ignored; opting out of pruning has to be spelled `{ keepAll: true }`.
 */
export function keepsAll(includeSecondaries: IncludeSecondariesOptions | undefined): boolean {
  return typeof includeSecondaries === 'object' && !!includeSecondaries.keepAll;
}

/**
 * Turns a wildcard mapping into the concrete entry points it stands for. A path containing a
 * wildcard segment is not something the bundler can resolve, so it has to be walked on disk;
 * the reachability pass is the only other thing that can materialise one.
 */
export function expandWildcardMapping(
  mappedPath: string,
  mappedImport: string,
  ctx: MappingExpansionContext
): PathToImport {
  const relPattern = toPosix(path.relative(ctx.workspaceRoot, mappedPath));

  const pairs = resolvePackageJsonExportsWildcardCore(
    ctx.io,
    mappedImport,
    relPattern,
    ctx.workspaceRoot
  );

  if (pairs.length === 0) {
    logger.warn(`Mapping '${mappedImport}' matched no files on disk and was not shared.`);
  }

  return pairs.reduce((acc, { key, value }) => {
    acc[path.join(ctx.workspaceRoot, value)] = key;
    return acc;
  }, {} as PathToImport);
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

    const mappingConfig = resolveMappingConfig(mappedImport, config.sharedMappingsConfig);
    if (resolvesGlob(mappingConfig?.includeSecondaries)) {
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
