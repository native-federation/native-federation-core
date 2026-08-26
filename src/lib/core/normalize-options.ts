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
import { toDiskCase } from '../utils/disk-case.js';

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

  const workspaceRoot = toDiskCase(deps.io, options.workspaceRoot);

  const fullConfigPath = path.join(workspaceRoot, options.federationConfig);

  if (!deps.io.exists(fullConfigPath)) {
    throw new Error('Expected ' + fullConfigPath);
  }

  let config: NormalizedFederationConfig = await deps.loadConfig(fullConfigPath);

  /**
   * Step 2: normalizing options
   */
  const projectName = resolveProjectName(options.projectName ?? config.name);

  const suppliedCache =
    cache ??
    (createFederationCache(
      getDefaultCachePath(workspaceRoot)
    ) as FederationCache<TBundlerCache>);

  const federationCache: FederationCache<TBundlerCache> = {
    ...suppliedCache,
    cachePath: path.join(suppliedCache.cachePath, projectName),
    externals: [...suppliedCache.externals],
  };

  const normalizedOptions: NormalizedFederationOptions<TBundlerCache> = {
    ...options,
    workspaceRoot,
    entryPoints: options.entryPoints ?? Object.values(config.exposes ?? {}).map(e => e.file),
    projectName,
    cacheExternalArtifacts: options.cacheExternalArtifacts ?? true,
    watchLinkedDeps: options.watchLinkedDeps ?? false,
    federationCache,
  };

  /**
   * Step 3: Remove unused deps
   */

  const nothingShared =
    Object.keys(config.shared).length === 0 && Object.keys(config.sharedMappings).length === 0;

  if (nothingShared) {
    logger.debug('Nothing is shared, skipping the used dependency scan.');
  } else if (config.features.ignoreUnusedDeps) {
    const getUsedDeps = (deps.usedDependenciesFactory ?? getUsedDependenciesFactory)(
      workspaceRoot,
      options.entryPoints
    );
    config = removeUnusedDeps(getUsedDeps(config), config, {
      io: deps.io,
      workspaceRoot,
    });
    logger.info('Removed unused dependencies.');
    logger.debug(
      'This can be disabled per dependency/external using the "includeSecondaries: {keepAll: true}" property. Or in general by disabling the "ignoreUnusedDeps" feature. '
    );
  } else {
    config.sharedMappings = expandOrDropWildcards(config, {
      io: deps.io,
      workspaceRoot,
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
