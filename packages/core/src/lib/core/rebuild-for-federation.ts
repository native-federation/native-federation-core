import type { FederationInfo } from '../domain/core/federation-info.contract.js';
import {
  bundleExposedAndMappings,
  describeExposed,
  describeSharedMappings,
} from './bundle-exposed-and-mappings.js';
import type { NormalizedFederationOptions } from '../domain/core/federation-options.contract.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';
import { logger } from '../utils/logger.js';
import { AbortedError } from '../utils/errors.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';

export async function rebuildForFederation(
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  externals: string[],
  modifiedFiles: string[],
  signal?: AbortSignal
): Promise<FederationInfo> {
  const federationCache = fedOptions.federationCache;

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

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(federationCache, fedOptions);

  return federationInfo;
}
