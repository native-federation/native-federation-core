import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import {
  bundleExposedAndMappings,
  describeExposed,
  describeSharedMappings,
} from './bundle-exposed-and-mappings.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { writeFederationInfo } from '../output/write-federation-info.js';
import { writeImportMap } from '../output/write-import-map.js';
import { logger } from '../../utils/logger.js';
import { AbortedError } from '../../utils/errors.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { planSharedBundles } from './shared-bundle-plan.js';
import { executeSharedBundlePlans } from './build-for-federation.js';
import { affectedSharedKeys, resolveSharedPackageDirs } from './resolve-shared-dirs.js';
import { cacheEntryCore, getFilename } from '../cache/cache-persistence.js';
import { nodeIo } from '../../utils/io/node-io-adapter.js';
import type { IoPort } from '../../domain/utils/io-port.contract.js';
import type { PackageJsonRepository } from '../../domain/utils/package-json.contract.js';
import { sharedPackageJsonRepository } from '../../utils/package/package-info.js';

export async function rebuildForFederation(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles: string[],
  signal?: AbortSignal
): Promise<FederationInfo> {
  const federationCache = fedOptions.federationCache;

  await rebuildAffectedExternals(config, fedOptions, externals, modifiedFiles, signal);

  logger.info(`Re-bundling all internal libraries and exposed modules..'`);
  const start = process.hrtime();

  const artifactInfo = await bundleExposedAndMappings(
    config,
    fedOptions,
    externals,
    modifiedFiles,
    signal
  );
  logger.measure(start, 'To re-bundle all internal libraries and exposed modules.');

  if (signal?.aborted)
    throw new AbortedError('[buildForFederation] After exposed-and-mappings bundle');

  const exposedInfo = !artifactInfo ? describeExposed(config, fedOptions) : artifactInfo.exposes;

  const sharedMappingInfo = !artifactInfo
    ? describeSharedMappings(config, fedOptions)
    : artifactInfo.mappings;

  const sharedExternals = [...federationCache.externals, ...sharedMappingInfo];

  const buildNotificationsEndpoint =
    fedOptions.buildNotifications?.enable && fedOptions.dev
      ? fedOptions.buildNotifications?.endpoint
      : undefined;

  const federationInfo: FederationInfo = {
    name: config.name,
    shared: sharedExternals,
    exposes: exposedInfo,
    buildNotificationsEndpoint,
  };

  if (federationCache.chunks) {
    federationInfo.chunks = federationCache.chunks;
  }

  if (artifactInfo?.chunks) {
    federationInfo.chunks = { ...(federationInfo.chunks ?? {}), ...artifactInfo?.chunks };
  }

  if (config.features.integrityHashes) {
    federationInfo.integrity = {
      ...(federationCache.integrity ?? {}),
      ...(artifactInfo?.integrity ?? {}),
    };
  }

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(federationCache, fedOptions, federationInfo.integrity);

  return federationInfo;
}

/**
 * When a modified file belongs to a shared package (e.g. npm-linked dev dep),
 * re-bundle the affected bundle(s); unchanged bundles hit their cache, so
 * `federationCache.externals` regenerates cheaply. No package touched → no-op.
 */
export async function rebuildAffectedExternals(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles: string[],
  signal?: AbortSignal,
  io: IoPort = nodeIo,
  repo: PackageJsonRepository = sharedPackageJsonRepository
): Promise<void> {
  if (modifiedFiles.length === 0) return;

  const plans = planSharedBundles(config, externals);
  if (plans.length === 0) return;

  const dirs = resolveSharedPackageDirs(config, fedOptions, io, repo);
  const affected = affectedSharedKeys(modifiedFiles, dirs, io);
  const affectedPlans = plans.filter(p => p.keys.some(k => affected.has(k)));
  if (affectedPlans.length === 0) return;

  const federationCache = fedOptions.federationCache;
  // Authoritative, modifiedFiles-driven invalidation. bundleShared already misses
  // its cache when the content-signal changes, but that signal is an mtime heuristic;
  // clearing here covers the cases it can miss (mtime granularity, a deleted file).
  for (const plan of affectedPlans) {
    logger.info(`Detected change in linked shared package(s); re-bundling '${plan.bundleName}'.`);
    cacheEntryCore(io, federationCache.cachePath, getFilename(plan.bundleName, fedOptions.dev)).clear();
  }

  federationCache.externals = [];
  federationCache.chunks = undefined;
  federationCache.integrity = undefined;

  await executeSharedBundlePlans(plans, config, fedOptions, signal);
}
