import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type {
  FederationOptions,
  NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { removeUnusedDeps } from '../config/remove-unused-deps.js';
import { type FederationCache } from '../../domain.js';
import { createFederationCache } from './federation-cache.js';
import { getDefaultCachePath } from '../utils/cache-persistence.js';
import { getUsedDependenciesFactory } from '../utils/get-used-dependencies.js';
import { logger } from '../utils/logger.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { normalizePackageName } from '../utils/normalize.js';

export function normalizeFederationOptions(
  options: FederationOptions
): Promise<{ config: NormalizedFederationConfig; options: NormalizedFederationOptions<undefined> }>;
export function normalizeFederationOptions<TBundlerCache>(
  options: FederationOptions,
  cache: FederationCache<TBundlerCache>
): Promise<{
  config: NormalizedFederationConfig;
  options: NormalizedFederationOptions<TBundlerCache>;
}>;
export async function normalizeFederationOptions<TBundlerCache = undefined>(
  options: FederationOptions,
  cache?: FederationCache<TBundlerCache>
): Promise<{
  config: NormalizedFederationConfig;
  options: NormalizedFederationOptions<TBundlerCache>;
}> {
  /**
   * Step 1: normalizing config
   */
  const fullConfigPath = path.join(options.workspaceRoot, options.federationConfig);
  const getUsedDeps = getUsedDependenciesFactory(options.workspaceRoot, options.entryPoints);

  if (!fs.existsSync(fullConfigPath)) {
    throw new Error('Expected ' + fullConfigPath);
  }

  let config: NormalizedFederationConfig = (await import(pathToFileURL(fullConfigPath).href))
    ?.default;

  /**
   * Step 2: normalizing options
   */
  const federationCache =
    cache ??
    (createFederationCache(
      getDefaultCachePath(options.workspaceRoot)
    ) as FederationCache<TBundlerCache>);

  const normalizedOptions: NormalizedFederationOptions<TBundlerCache> = {
    ...options,
    entryPoints: options.entryPoints ?? Object.values(config.exposes ?? {}),
    projectName: resolveProjectName(options.projectName ?? config.name),
    cacheExternalArtifacts: options.cacheExternalArtifacts ?? true,
    federationCache,
  };

  /**
   * Step 3: Remove unused deps
   */

  if (config.features.ignoreUnusedDeps) {
    config = removeUnusedDeps(getUsedDeps(config), config);
    logger.info('Removed unused dependencies.');
    logger.debug(
      'This can be disabled per dependency/external using the "includeSecondaries: {keepAll: true}" property. Or in general by disabling the "ignoreUnusedDeps" feature. '
    );
  } else {
    const withWildcard = Object.keys(config.sharedMappings).some(m => m.includes('*'));
    if (withWildcard) {
      logger.warn(
        'Sharing mapped paths with wildcards (*) is only supported with ignoreUnusedDeps feature.'
      );
      config.sharedMappings = Object.entries(config.sharedMappings)
        .filter(([_path]) => !_path.includes('*'))
        .reduce((acc, [_path, _import]) => ({ ...acc, [_path]: _import }), {} as PathToImport);
    }
  }

  return { config, options: normalizedOptions };
}

export function resolveProjectName(name?: string): string {
  if (!name || name.length < 1) {
    logger.warn(
      "Project name in 'federation.config.js' is empty, defaulting to 'shell' cache folder (could collide with other projects in the workspace)."
    );
    return 'shell';
  }

  return normalizePackageName(name);
}
