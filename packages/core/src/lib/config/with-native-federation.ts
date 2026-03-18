import { getMappedPaths } from '../utils/mapped-paths.js';
import { shareAll, findRootTsConfigJson } from './share-utils.js';
import type {
  FederationConfig,
  NormalizedFederationConfig,
} from '../domain/config/federation-config.contract.js';
import { isInSkipList, prepareSkipList } from './default-skip-list.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';
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

  return normalized;
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
        platform: sharedConfig.platform ?? config.platform ?? 'browser',
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
  skipList: PreparedSkipList
): Array<MappedPath> {
  const rootTsConfigPath = findRootTsConfigJson();

  const paths = getMappedPaths({
    rootTsConfigPath,
    sharedMappings: config.sharedMappings,
  });

  return paths.filter(p => !isInSkipList(p.key, skipList));
}
