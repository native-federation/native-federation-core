import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import {
  bundleExposedAndMappings,
  describeExposed,
  describeSharedMappings,
} from './bundle-exposed-and-mappings.js';
import { bundleShared } from './bundle-shared.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { densifyExternals } from '../output/densify-externals.js';
import { writeFederationInfo } from '../output/write-federation-info.js';
import { writeImportMap } from '../output/write-import-map.js';
import { logger } from '../../utils/logger.js';
import { AbortedError } from '../../utils/errors.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { addExternalsToCache } from '../cache/federation-cache.js';
import { planSharedBundles, type SharedBundlePlan } from './shared-bundle-plan.js';
import path from 'path';

export async function buildForFederation(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  signal?: AbortSignal
): Promise<FederationInfo> {
  // 1. Setup
  fedOptions.federationCache.cachePath = path.join(
    fedOptions.federationCache.cachePath,
    fedOptions.projectName
  );
  logger.info('Building federation artifacts');
  logger.notice("Skip packages you don't want to share in your federation config");

  // 2. Externals
  await executeSharedBundlePlans(planSharedBundles(config, externals), config, fedOptions, signal);

  // 2. Shared mappings and exposed modules
  const start = process.hrtime();

  const artifactInfo = await bundleExposedAndMappings(
    config,
    fedOptions,
    externals,
    undefined,
    signal
  );
  logger.measure(start, 'Step 3) Bundling all internal libraries and exposed modules.');

  if (signal?.aborted)
    throw new AbortedError('[buildForFederation] After exposed-and-mappings bundle');

  const exposedInfo = !artifactInfo ? describeExposed(config, fedOptions) : artifactInfo.exposes;

  const sharedMappingInfo = !artifactInfo
    ? describeSharedMappings(config, fedOptions)
    : artifactInfo.mappings;

  const sharedExternals = [...fedOptions.federationCache.externals, ...sharedMappingInfo];

  if (config?.shareScope) {
    Object.values(sharedExternals).forEach(external => {
      if (!external.shareScope) external.shareScope = config.shareScope;
    });
  }

  const shared = config.features.denseExternals
    ? densifyExternals(sharedExternals)
    : sharedExternals;

  const buildNotificationsEndpoint =
    fedOptions.buildNotifications?.enable && fedOptions.dev
      ? fedOptions.buildNotifications?.endpoint
      : undefined;
  const federationInfo: FederationInfo = {
    name: config.name,
    shared,
    exposes: exposedInfo,
    buildNotificationsEndpoint,
  };
  if (fedOptions.federationCache.chunks) {
    federationInfo.chunks = fedOptions.federationCache.chunks;
  }
  if (artifactInfo?.chunks) {
    federationInfo.chunks = { ...(federationInfo.chunks ?? {}), ...artifactInfo?.chunks };
  }

  if (config.features.integrityHashes) {
    federationInfo.integrity = {
      ...(fedOptions.federationCache.integrity ?? {}),
      ...(artifactInfo?.integrity ?? {}),
    };
  }

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(fedOptions.federationCache, fedOptions, federationInfo.integrity);

  return federationInfo;
}

/**
 * Bundles shared/separate externals per plan and populates the federation cache.
 * Shared bundles run sequentially (with signal checks); separate bundles run in
 * parallel. Shared by the initial build and the watch rebuild.
 */
export async function executeSharedBundlePlans(
  plans: SharedBundlePlan[],
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  signal?: AbortSignal
): Promise<void> {
  for (const plan of plans.filter(p => p.kind === 'shared')) {
    logger.info(`Bundling external npm packages with bundle type '${plan.bundleName}'`);
    const start = process.hrtime();

    const info = await bundleShared(plan.entries, config, fedOptions, plan.externals, {
      platform: plan.platform,
      bundleName: plan.bundleName,
      chunks: plan.chunks,
    });

    logger.measure(start, `Step 2.1) Bundling '${plan.bundleName}' externals`);
    addExternalsToCache(fedOptions.federationCache, info);

    if (signal?.aborted)
      throw new AbortedError(`[buildForFederation] After ${plan.bundleName} bundle`);
  }

  const separatePlans = plans.filter(p => p.kind === 'separate');
  if (separatePlans.length > 0) {
    const start = process.hrtime();
    const results = await Promise.all(
      separatePlans.map(plan =>
        bundleShared(plan.entries, config, fedOptions, plan.externals, {
          platform: plan.platform,
          bundleName: plan.bundleName,
          chunks: plan.chunks,
        })
      )
    );
    logger.measure(start, 'Step 2.2) Bundling all separate external packages');
    for (const info of results) addExternalsToCache(fedOptions.federationCache, info);

    if (signal?.aborted) throw new AbortedError('[buildForFederation] After separate bundle');
  }
}
