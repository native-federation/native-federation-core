import type { FederationInfo } from '../../domain/core/federation-info.contract.js';
import { bundleExposedAndMappings } from './bundle-exposed-and-mappings.js';
import { bundleShared } from './bundle-shared.js';
import type { NormalizedFederationOptions } from '../../domain/core/federation-options.contract.js';
import { logger } from '../../utils/logger.js';
import { AbortedError } from '../../utils/errors.js';
import type { NormalizedFederationConfig } from '../../domain/config/federation-config.contract.js';
import { addExternalsToCache, withStagedExternals } from '../cache/federation-cache.js';
import { finalizeFederationBuild } from './finalize-federation-build.js';
import { planSharedBundles, type SharedBundlePlan } from './shared-bundle-plan.js';
import { hintUnwatchedLinkedDeps } from './resolve-shared-dirs.js';
import { prepareCache } from '../cache/cache-persistence.js';

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
  // Before any plan: the separate plans build in parallel.
  prepareCache(fedOptions.federationCache.cachePath);

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

  return finalizeFederationBuild(config, fedOptions, artifactInfo, { fullReport: true });
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
  const runPlan = (plan: SharedBundlePlan) =>
    bundleShared(plan.entries, config, fedOptions, plan.externals, {
      platform: plan.platform,
      bundleName: plan.bundleName,
      chunks: plan.chunks,
    });

  await withStagedExternals(fedOptions.federationCache, async staged => {
    for (const plan of plans.filter(p => p.kind === 'shared')) {
      logger.info(`Bundling external npm packages with bundle type '${plan.bundleName}'`);
      const start = process.hrtime();

      const info = await runPlan(plan);

      logger.measure(start, `Step 2.1) Bundling '${plan.bundleName}' externals`);
      addExternalsToCache(staged, plan.bundleName, info);

      if (signal?.aborted)
        throw new AbortedError(`[executeSharedBundlePlans] After ${plan.bundleName} bundle`);
    }

    const separatePlans = plans.filter(p => p.kind === 'separate');
    if (separatePlans.length > 0) {
      const start = process.hrtime();
      const results = await allOrFirstFailure(
        separatePlans.map(async plan => ({ plan, info: await runPlan(plan) }))
      );
      logger.measure(start, 'Step 2.2) Bundling all separate external packages');
      for (const { plan, info } of results) {
        addExternalsToCache(staged, plan.bundleName, info);
      }

      if (signal?.aborted)
        throw new AbortedError('[executeSharedBundlePlans] After separate bundle');
    }
  });
}

// Unlike Promise.all, waits for every bundle before it rethrows, so a failed one cannot leave its
// siblings running into the next rebuild, which re-runs every plan after an incomplete run.
async function allOrFirstFailure<T>(tasks: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed) throw failed.reason;
  return settled.map(result => (result as PromiseFulfilledResult<T>).value);
}
