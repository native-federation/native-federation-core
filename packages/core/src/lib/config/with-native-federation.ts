import { getMappedPaths } from '../utils/mapped-paths.js';
import { shareAll, findRootTsConfigJson } from './share-utils.js';
import type {
  FederationConfig,
  NormalizedFederationConfig,
} from '../domain/config/federation-config.contract.js';
import { isInSkipList, prepareSkipList } from './default-skip-list.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';

import { logger } from '../utils/logger.js';
import { DEFAULT_SERVER_DEPS_LIST } from '../core/default-server-deps-list.js';
import type {
  NormalizedExternalConfig,
  NormalizedSharedExternalsConfig,
} from '../domain/config/external-config.contract.js';
import type { MappedPath } from '../domain/utils/mapped-path.contract.js';

export function withNativeFederation(config: FederationConfig): NormalizedFederationConfig {
  const skip = prepareSkipList(config.skip ?? []);

  const normalized: NormalizedFederationConfig = {
    name: config.name ?? '',
    exposes: config.exposes ?? {},
    shared: normalizeShared(config, skip),
    sharedMappings: normalizeSharedMappings(config, skip),
    skip,
    externals: config.externals ?? [],
    features: {
      mappingVersion: config.features?.mappingVersion ?? false,
      ignoreUnusedDeps: config.features?.ignoreUnusedDeps ?? false,
    },
    ...(config.shareScope && { shareScope: config.shareScope }),
  };

  // This is for being backwards compatible
  if (!normalized.features.ignoreUnusedDeps) {
    normalized.shared = filterShared(normalized.shared);
  }

  return normalized;
}

function filterShared(shared: NormalizedSharedExternalsConfig): NormalizedSharedExternalsConfig {
  const keys = Object.keys(shared).filter(k => !k.startsWith('@angular/common/locales'));

  const filtered = keys.reduce(
    (acc, curr) => ({
      ...acc,
      [curr]: shared[curr],
    }),
    {}
  );

  return filtered;
}

function normalizeShared(
  config: FederationConfig,
  skip: PreparedSkipList
): NormalizedSharedExternalsConfig {
  let result: NormalizedSharedExternalsConfig = {};

  const shared = config.shared;

  if (!shared) {
    result = shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      platform: 'browser',
    }) as NormalizedSharedExternalsConfig;
  } else {
    result = Object.keys(shared).reduce<NormalizedSharedExternalsConfig>((acc, cur) => {
      const key = cur.replace(/\\/g, '/');
      const sharedConfig = shared[cur]!;
      const normalizedConfig: NormalizedExternalConfig = {
        requiredVersion: sharedConfig.requiredVersion ?? 'auto',
        singleton: sharedConfig.singleton ?? false,
        strictVersion: sharedConfig.strictVersion ?? false,
        version: sharedConfig.version,
        includeSecondaries: sharedConfig.includeSecondaries,
        packageInfo: sharedConfig.packageInfo as NormalizedExternalConfig['packageInfo'],
        platform: sharedConfig.platform ?? getDefaultPlatform(cur),
        build: sharedConfig.build ?? 'default',
        ...(sharedConfig.shareScope && { shareScope: sharedConfig.shareScope }),
      };
      return {
        ...acc,
        [key]: normalizedConfig,
      };
    }, {});
  }

  result = Object.keys(result)
    .filter(key => !isInSkipList(key, skip))
    .reduce((acc, cur) => ({ ...acc, [cur]: result[cur] }), {});

  return result;
}

function normalizeSharedMappings(
  config: FederationConfig,
  skip: PreparedSkipList
): Array<MappedPath> {
  const rootTsConfigPath = findRootTsConfigJson();

  const paths = getMappedPaths({
    rootTsConfigPath,
    sharedMappings: config.sharedMappings,
  });

  const result = paths.filter(p => !isInSkipList(p.key, skip) && !p.key.includes('*'));

  if (paths.find(p => p.key.includes('*'))) {
    logger.warn('Sharing mapped paths with wildcards (*) not supported');
  }

  return result;
}

function getDefaultPlatform(cur: string): 'browser' | 'node' {
  if (DEFAULT_SERVER_DEPS_LIST.find(e => cur.startsWith(e))) {
    return 'node';
  } else {
    return 'browser';
  }
}
