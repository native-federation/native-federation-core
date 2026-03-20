import type {
  ChunkInfo,
  FederationInfo,
  SharedInfo,
} from '../domain/core/federation-info.contract.js';
import {
  bundleExposedAndMappings,
  describeExposed,
  describeSharedMappings,
} from './bundle-exposed-and-mappings.js';
import { bundleShared } from './bundle-shared.js';
import type { NormalizedFederationOptions } from '../domain/core/federation-options.contract.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';
import { logger } from '../utils/logger.js';
import { normalizePackageName } from '../utils/normalize.js';
import { AbortedError } from '../utils/errors.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../domain/config/external-config.contract.js';
import { addExternalsToCache } from './federation-cache.js';
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

  // 2. Externals
  if (fedOptions.federationCache.externals.length > 0) {
    logger.info('Checksum matched, re-using cached externals.');
  }

  if (fedOptions.federationCache.externals.length === 0) {
    const { sharedBrowser, sharedServer, separateBrowser, separateServer } = splitShared(
      config.shared
    );

    if (Object.keys(sharedBrowser).length > 0) {
      notifyBundling('browser-shared');
      const start = process.hrtime();
      const sharedPackageInfoBrowser = await bundleShared(
        sharedBrowser,
        config,
        fedOptions,
        externals,
        { platform: 'browser', bundleName: 'browser-shared' }
      );

      logger.measure(start, '[build artifacts] - To bundle all shared browser externals');

      addExternalsToCache(fedOptions.federationCache, sharedPackageInfoBrowser);

      if (signal?.aborted)
        throw new AbortedError('[buildForFederation] After shared-browser bundle');
    }

    if (Object.keys(sharedServer).length > 0) {
      notifyBundling('server-shared');
      const start = process.hrtime();
      const sharedPackageInfoServer = await bundleShared(
        sharedServer,
        config,
        fedOptions,
        externals,
        { platform: 'node', bundleName: 'node-shared' }
      );
      logger.measure(start, '[build artifacts] - To bundle all shared node externals');

      addExternalsToCache(fedOptions.federationCache, sharedPackageInfoServer);

      if (signal?.aborted) throw new AbortedError('[buildForFederation] After shared-node bundle');
    }

    if (Object.keys(separateBrowser).length > 0) {
      notifyBundling('browser-separate');
      const start = process.hrtime();
      const separatePackageInfoBrowser = await bundleSeparatePackages(
        separateBrowser,
        externals,
        config,
        fedOptions,
        { platform: 'browser' }
      );
      logger.measure(start, '[build artifacts] - To bundle all separate browser externals');
      addExternalsToCache(fedOptions.federationCache, separatePackageInfoBrowser);
      if (signal?.aborted)
        throw new AbortedError('[buildForFederation] After separate-browser bundle');
    }

    if (Object.keys(separateServer).length > 0) {
      notifyBundling('server-separate');
      const start = process.hrtime();
      const separatePackageInfoServer = await bundleSeparatePackages(
        separateServer,
        externals,
        config,
        fedOptions,
        { platform: 'node' }
      );

      logger.measure(start, '[build artifacts] - To bundle all separate node externals');
      addExternalsToCache(fedOptions.federationCache, separatePackageInfoServer);
    }

    if (signal?.aborted) throw new AbortedError('[buildForFederation] After separate-node bundle');
  }

  // 2. Shared mappings and exposed modules
  const start = process.hrtime();

  const artifactInfo = await bundleExposedAndMappings(
    config,
    fedOptions,
    externals,
    undefined,
    signal
  );
  logger.measure(start, '[build artifacts] - To bundle all mappings and exposed.');

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
  if (fedOptions.federationCache.chunks) {
    federationInfo.chunks = fedOptions.federationCache.chunks;
  }
  if (artifactInfo?.chunks) {
    federationInfo.chunks = { ...(federationInfo.chunks ?? {}), ...artifactInfo?.chunks };
  }

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(fedOptions.federationCache, fedOptions);

  return federationInfo;
}

type SplitSharedResult = {
  sharedServer: Record<string, NormalizedExternalConfig>;
  sharedBrowser: Record<string, NormalizedExternalConfig>;
  separateBrowser: Record<string, NormalizedExternalConfig>;
  separateServer: Record<string, NormalizedExternalConfig>;
};

function inferPackageFromSecondary(secondary: string): string {
  const parts = secondary.split('/');
  if (secondary.startsWith('@') && parts.length >= 2) {
    return parts[0] + '/' + parts[1];
  }
  return parts[0]!;
}

async function bundleSeparatePackages(
  separateBrowser: Record<string, NormalizedExternalConfig>,
  externals: string[],
  config: NormalizedFederationConfig,
  fedOptions: NormalizedFederationOptions,
  buildOptions: { platform: 'browser' | 'node' }
) {
  const groupedByPackage: Record<string, Record<string, NormalizedExternalConfig>> = {};

  for (const [key, shared] of Object.entries(separateBrowser)) {
    const packageName = shared.build === 'separate' ? key : inferPackageFromSecondary(key);
    if (!groupedByPackage[packageName]) {
      groupedByPackage[packageName] = {};
    }
    groupedByPackage[packageName][key] = shared;
  }

  const bundlePromises = Object.entries(groupedByPackage).map(
    async ([packageName, sharedGroup]) => {
      return bundleShared(
        sharedGroup,
        config,
        fedOptions,
        externals.filter(e => !e.startsWith(packageName)),
        {
          platform: buildOptions.platform,
          bundleName: `${buildOptions.platform}-${normalizePackageName(packageName)}`,
        }
      );
    }
  );

  const buildResults = await Promise.all(bundlePromises);
  return buildResults.reduce(
    (acc, r) => {
      let chunks = acc.chunks;
      if (r.chunks) {
        chunks = { ...(acc.chunks ?? {}), ...r.chunks };
      }
      return { externals: [...acc.externals, ...r.externals], chunks };
    },
    { externals: [] } as { externals: SharedInfo[]; chunks?: ChunkInfo }
  );
}

function notifyBundling(platform: string) {
  logger.info(`Preparing shared npm packages with bundle type "${platform}"`);
  logger.notice('This only needs to be done once, as results are cached');
  logger.notice("Skip packages you don't want to share in your federation config");
}

function splitShared(shared: Record<string, NormalizedExternalConfig>): SplitSharedResult {
  const sharedServer: Record<string, NormalizedExternalConfig> = {};
  const sharedBrowser: Record<string, NormalizedExternalConfig> = {};
  const separateBrowser: Record<string, NormalizedExternalConfig> = {};
  const separateServer: Record<string, NormalizedExternalConfig> = {};

  for (const key in shared) {
    const obj = shared[key];

    if (obj?.platform === 'node') {
      if (obj.build === 'default') {
        sharedServer[key] = obj;
      } else {
        separateServer[key] = obj;
      }
    } else if (obj?.platform === 'browser') {
      if (obj.build === 'default') {
        sharedBrowser[key] = obj;
      } else {
        separateBrowser[key] = obj;
      }
    }
  }

  return {
    sharedBrowser,
    sharedServer,
    separateBrowser,
    separateServer,
  };
}
