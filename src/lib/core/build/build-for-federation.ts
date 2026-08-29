import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import { bundleExposedAndMappings } from './bundle-exposed-and-mappings.js';
import { bundleShared } from './bundle-shared.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { assembleFederationInfo } from './assemble-federation-info.js';
import { writeFederationOutputs } from '../output/write-federation-outputs.js';
import { logger } from '../../utils/logger.js';
import { AbortedError } from '../../utils/errors.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { addExternalsToCache } from '../cache/federation-cache.js';
import { planSharedBundles, type SharedBundlePlan } from './shared-bundle-plan.js';
import { hintUnwatchedLinkedDeps } from './resolve-shared-dirs.js';

export async function buildForFederation(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  signal?: AbortSignal
): Promise<FederationInfo> {
  // 1. Setup
  logger.info('Building federation artifacts');
  logger.notice("Skip packages you don't want to share in your federation config");
  hintUnwatchedLinkedDeps(config, fedOptions);

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

  const federationInfo = assembleFederationInfo(config, fedOptions, artifactInfo);
  writeFederationOutputs(federationInfo, fedOptions);

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
      throw new AbortedError(`[executeSharedBundlePlans] After ${plan.bundleName} bundle`);
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

    if (signal?.aborted) throw new AbortedError('[executeSharedBundlePlans] After separate bundle');
  }
}
