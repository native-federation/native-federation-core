import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type {
  FederationOptions,
  NormalizedFederationOptions,
} from '../domain/core/federation-options.contract.js';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { nodeIo } from '../utils/io/node-io-adapter.js';
import type { FileReaderPort } from '../domain/utils/io-port.contract.js';
import { removeUnusedDeps } from '../config/remove-unused-deps.js';
import { type FederationCache } from '../../domain.js';
import { createFederationCache } from './federation-cache.js';
import { getDefaultCachePath } from './cache-persistence.js';
import { getUsedDependenciesFactory } from '../config/get-used-dependencies.js';
import { logger } from '../utils/logger.js';
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { normalizePackageName } from '../utils/normalize.js';

// Loads the federation config module. Defaults to a dynamic import() of the
// resolved file URL; tests inject a fake so the config can be supplied directly.
export type ConfigLoader = (fullConfigPath: string) => Promise<NormalizedFederationConfig>;

const defaultConfigLoader: ConfigLoader = async fullConfigPath =>
  (await import(pathToFileURL(fullConfigPath).href))?.default;

interface NormalizeFederationDeps {
  io: FileReaderPort;
  loadConfig: ConfigLoader;
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
  const getUsedDeps = getUsedDependenciesFactory(options.workspaceRoot, options.entryPoints);

  // NOTE: the config module itself is loaded via the injected ConfigLoader
  // (a dynamic import() in production), which is a module-loader concern outside
  // IoPort; only the existence check is ported.
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

function resolveProjectName(name?: string): string {
  if (!name || name.length < 1) {
    logger.warn(
      "Project name in 'federation.config.js' is empty, defaulting to 'shell' cache folder (could collide with other projects in the workspace)."
    );
    return 'shell';
  }

  return normalizePackageName(name);
}
