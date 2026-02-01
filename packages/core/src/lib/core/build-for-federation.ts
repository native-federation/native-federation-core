import type {
  ArtefactInfo,
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
import type { FederationOptions } from '../domain/core/federation-options.contract.js';
import { writeFederationInfo } from './write-federation-info.js';
import { writeImportMap } from './write-import-map.js';
import { logger } from '../utils/logger.js';
import { getCachePath } from './../utils/bundle-caching.js';
import { normalizePackageName } from '../utils/normalize.js';
import { AbortedError } from '../utils/errors.js';
import type { NormalizedFederationConfig } from '../domain/config/federation-config.contract.js';
import type { NormalizedExternalConfig } from '../domain/config/external-config.contract.js';
import type { BuildParams } from '../domain/core/build-params.contract.js';

export const defaultBuildParams: BuildParams = {
  skipMappingsAndExposed: false,
  skipShared: false,
};

const sharedCache: { externals: SharedInfo[]; chunks?: ChunkInfo } = { externals: [] };

export async function buildForFederation(
  config: NormalizedFederationConfig,
  fedOptions: FederationOptions,
  externals: string[],
  buildParams = defaultBuildParams
): Promise<FederationInfo> {
  const signal = buildParams.signal;

  let artefactInfo: ArtefactInfo | undefined;

  if (!buildParams.skipMappingsAndExposed) {
    const start = process.hrtime();
    artefactInfo = await bundleExposedAndMappings(config, fedOptions, externals, signal);
    logger.measure(start, '[build artifacts] - To bundle all mappings and exposed.');

    if (signal?.aborted)
      throw new AbortedError('[buildForFederation] After exposed-and-mappings bundle');
  }

  const exposedInfo = !artefactInfo ? describeExposed(config, fedOptions) : artefactInfo.exposes;

  const normalizedCacheFolder = normalizePackageName(config.name);
  if (normalizedCacheFolder.length < 1) {
    logger.warn(
      "Project name in 'federation.config.js' is empty, defaulting to 'shell' cache folder (could collide with other projects in the workspace)."
    );
  }
  const cacheProjectFolder = normalizedCacheFolder.length < 1 ? 'shell' : normalizedCacheFolder;

  const pathToCache = getCachePath(fedOptions.workspaceRoot, cacheProjectFolder);

  if (!buildParams.skipShared && sharedCache.externals.length > 0) {
    logger.info('Checksum matched, re-using cached externals.');
  }

  if (!buildParams.skipShared && sharedCache.externals.length === 0) {
    const { sharedBrowser, sharedServer, separateBrowser, separateServer } = splitShared(
      config.shared
    );
    let buildIDX = 0;

    if (Object.keys(sharedBrowser).length > 0) {
      notifyBundling('browser-shared');
      const start = process.hrtime();
      const sharedPackageInfoBrowser = await bundleShared(
        sharedBrowser,
        config,
        fedOptions,
        externals,
        'browser',
        buildIDX, // 0
        { pathToCache, bundleName: 'browser-shared' }
      );

      logger.measure(start, '[build artifacts] - To bundle all shared browser externals');

      addToCache(sharedPackageInfoBrowser);
      buildIDX++;

      if (signal?.aborted)
        throw new AbortedError('[buildForFederation] After shared-browser bundle');
    }
    buildIDX++;

    if (Object.keys(sharedServer).length > 0) {
      notifyBundling('browser-shared');
      const start = process.hrtime();
      const sharedPackageInfoServer = await bundleShared(
        sharedServer,
        config,
        fedOptions,
        externals,
        'node',
        buildIDX, // 0 (or 1)
        { pathToCache, bundleName: 'node-shared' }
      );
      logger.measure(start, '[build artifacts] - To bundle all shared node externals');

      addToCache(sharedPackageInfoServer);
      buildIDX++;

      if (signal?.aborted) throw new AbortedError('[buildForFederation] After shared-node bundle');
    }

    if (Object.keys(separateBrowser).length > 0) {
      notifyBundling('browser-shared');
      const start = process.hrtime();
      const separatePackageInfoBrowser = await bundleSeparatePackages(
        separateBrowser,
        externals,
        config,
        fedOptions,
        'browser',
        pathToCache,
        buildIDX
      );
      logger.measure(start, '[build artifacts] - To bundle all separate browser externals');
      addToCache(separatePackageInfoBrowser);
      buildIDX += Object.keys(separateBrowser).length;
      if (signal?.aborted)
        throw new AbortedError('[buildForFederation] After separate-browser bundle');
    }

    if (Object.keys(separateServer).length > 0) {
      notifyBundling('browser-shared');
      const start = process.hrtime();
      const separatePackageInfoServer = await bundleSeparatePackages(
        separateServer,
        externals,
        config,
        fedOptions,
        'node',
        pathToCache,
        buildIDX
      );
      buildIDX += Object.keys(separateBrowser).length;

      logger.measure(start, '[build artifacts] - To bundle all separate node externals');
      addToCache(separatePackageInfoServer);
    }

    if (signal?.aborted) throw new AbortedError('[buildForFederation] After separate-node bundle');
  }

  const sharedMappingInfo = !artefactInfo
    ? describeSharedMappings(config, fedOptions)
    : artefactInfo.mappings;

  addToCache({ externals: sharedMappingInfo });

  if (config?.shareScope) {
    Object.values(sharedCache.externals).forEach(external => {
      if (!external.shareScope) external.shareScope = config.shareScope;
    });
  }

  const buildNotificationsEndpoint =
    fedOptions.buildNotifications?.enable && fedOptions.dev
      ? fedOptions.buildNotifications?.endpoint
      : undefined;
  const federationInfo: FederationInfo = {
    name: config.name,
    shared: sharedCache.externals,
    exposes: exposedInfo,
    buildNotificationsEndpoint,
  };
  if (sharedCache.chunks) {
    federationInfo.chunks = sharedCache.chunks;
  }

  writeFederationInfo(federationInfo, fedOptions);
  writeImportMap(sharedCache, fedOptions);

  return federationInfo;
}

function addToCache({ externals, chunks }: { externals: SharedInfo[]; chunks?: ChunkInfo }) {
  sharedCache.externals.push(...externals);
  if (chunks) {
    if (!sharedCache.chunks) sharedCache.chunks = {};
    sharedCache.chunks = { ...sharedCache.chunks, ...chunks };
  }
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
  fedOptions: FederationOptions,
  platform: 'node' | 'browser',
  pathToCache: string,
  startBuildIDX: number
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
    async ([packageName, sharedGroup], idx) => {
      return bundleShared(
        sharedGroup,
        config,
        fedOptions,
        externals.filter(e => !e.startsWith(packageName)),
        platform,
        startBuildIDX + idx, // 0 and 1 are reserved for the default builds
        {
          pathToCache,
          bundleName: `${platform}-${normalizePackageName(packageName)}`,
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
  logger.info('Preparing shared npm packages for the platform ' + platform);
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
