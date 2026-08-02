import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type {
  FederationOptions,
  NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort, GlobPort } from '../domain/utils/io-port.contract.js';
import { removeUnusedDeps } from '../config/remove-unused-deps.js';
import { expandOrDropWildcards } from '../config/expand-mappings.js';
import { assertBarrelMappings } from '../config/validate-mappings.js';
import { type FederationCache } from '../../domain.js';
import { createFederationCache } from './cache/federation-cache.js';
import { getDefaultCachePath } from './cache/cache-persistence.js';
import { getUsedDependenciesFactory } from '../config/get-used-dependencies.js';
import { logger } from '../utils/logger.js';
import { normalizePackageName } from '../utils/normalize.js';

type ConfigLoader = (fullConfigPath: string) => Promise<NormalizedFederationConfig>;

const defaultConfigLoader: ConfigLoader = async fullConfigPath =>
  (await import(pathToFileURL(fullConfigPath).href))?.default;

interface NormalizeFederationDeps {
  io: FileReaderPort & GlobPort;
  loadConfig: ConfigLoader;
  usedDependenciesFactory?: typeof getUsedDependenciesFactory;
}

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
  return normalizeFederationOptionsCore(
    { io: nodeIo, loadConfig: defaultConfigLoader },
    options,
    cache
  );
}

export async function normalizeFederationOptionsCore<TBundlerCache = undefined>(
  deps: NormalizeFederationDeps,
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

  if (!deps.io.exists(fullConfigPath)) {
    throw new Error('Expected ' + fullConfigPath);
  }

  let config: NormalizedFederationConfig = await deps.loadConfig(fullConfigPath);

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
    entryPoints: options.entryPoints ?? Object.values(config.exposes ?? {}).map(e => e.file),
    projectName: resolveProjectName(options.projectName ?? config.name),
    cacheExternalArtifacts: options.cacheExternalArtifacts ?? true,
    federationCache,
  };

  /**
   * Step 3: Remove unused deps
   */

  if (config.features.ignoreUnusedDeps) {
    const getUsedDeps = (deps.usedDependenciesFactory ?? getUsedDependenciesFactory)(
      options.workspaceRoot,
      options.entryPoints
    );
    config = removeUnusedDeps(getUsedDeps(config), config, {
      io: deps.io,
      workspaceRoot: options.workspaceRoot,
    });
    logger.info('Removed unused dependencies.');
    logger.debug(
      'This can be disabled per dependency/external using the "includeSecondaries: {keepAll: true}" property. Or in general by disabling the "ignoreUnusedDeps" feature. '
    );
  } else {
    config.sharedMappings = expandOrDropWildcards(config, {
      io: deps.io,
      workspaceRoot: options.workspaceRoot,
    });
  }

  // Whatever survived either branch is what remoteEntry.json will advertise.
  assertBarrelMappings(config.sharedMappings);

  return { config, options: normalizedOptions };
}

function resolveProjectName(name?: string): string {
  if (!name || name.length < 1) {
    logger.warn(
      "Project name in 'federation.config.js' is empty, defaulting to 'shell' cache folder (could collide with other projects in the workspace)."
    );
    return 'shell';
  }

  return normalizePackageName(name);
}
