import { getMappedPaths, type MappedPath } from '../utils/mapped-paths.js';
import { shareAll, findRootTsConfigJson } from './share-utils.js';
import type { FederationConfig, NormalizedFederationConfig } from './federation-config.contract.js';
import { isInSkipList, type PreparedSkipList, prepareSkipList } from '../core/default-skip-list.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_SERVER_DEPS_LIST } from '../core/default-server-deps-list.js';
import type { NormalizedSharedExternalsConfig } from './external-config.contract.js';

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
    result = Object.keys(shared).reduce(
      (acc, cur) => ({
        ...acc,
        [cur.replace(/\\/g, '/')]: {
          requiredVersion: shared[cur]!.requiredVersion ?? 'auto',
          singleton: shared[cur]!.singleton ?? false,
          strictVersion: shared[cur]!.strictVersion ?? false,
          version: shared[cur]!.version,
          includeSecondaries: shared[cur]!.includeSecondaries,
          packageInfo: shared[cur]!.packageInfo,
          platform: shared[cur]!.platform ?? getDefaultPlatform(cur),
          build: shared[cur]!.build ?? 'default',
        },
      }),
      {}
    );

    //result = share(result) as Record<string, NormalizedSharedConfig>;
  }

  result = Object.keys(result)
    .filter(key => !isInSkipList(key, skip))
    .reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: result[cur],
      }),
      {}
    );

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
