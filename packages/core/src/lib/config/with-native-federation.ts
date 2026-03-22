import { getRawMappedPaths } from '../utils/mapped-paths.js';
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
import type { PathToImport } from '../domain/utils/mapped-path.contract.js';
import { logger } from '../utils/logger.js';

export function withNativeFederation(config: FederationConfig): NormalizedFederationConfig {
  const skip = prepareSkipList(config.skip ?? []);

  const chunks = config.chunks ?? true;

  const normalized: NormalizedFederationConfig = {
    $type: 'classic',
    name: config.name ?? '',
    exposes: config.exposes ?? {},
    shared: normalizeShared(config, skip, chunks),
    sharedMappings: removeSkippedMappings(config, skip),
    chunks,
    skip,
    externals: config.externals ?? [],
    features: {
      mappingVersion: config.features?.mappingVersion ?? false,
      ignoreUnusedDeps: config.features?.ignoreUnusedDeps ?? true,
      denseChunking: config.features?.denseChunking ?? false,
    },
    ...(config.shareScope && { shareScope: config.shareScope }),
  };

  return normalized;
}

function normalizeShared(
  config: FederationConfig,
  skip: PreparedSkipList,
  chunks: boolean
): NormalizedSharedExternalsConfig {
  let result: NormalizedSharedExternalsConfig = {};

  const shared =
    config.shared ??
    (shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      platform: 'browser',
    }) as NormalizedSharedExternalsConfig);

  result = Object.keys(shared).reduce<NormalizedSharedExternalsConfig>((acc, cur) => {
    const key = cur.replace(/\\/g, '/');
    const sharedConfig = shared[cur]!;

    if (!!sharedConfig.chunks && !sharedConfig.build && sharedConfig.chunks !== chunks) {
      logger.warn(
        `External '${cur}' has explicit chunk settings, consider switching build type to { build: 'package' }.`
      );
      sharedConfig.chunks = chunks;
    }

    const normalizedConfig: NormalizedExternalConfig = {
      requiredVersion: sharedConfig.requiredVersion ?? 'auto',
      singleton: sharedConfig.singleton ?? false,
      strictVersion: sharedConfig.strictVersion ?? false,
      version: sharedConfig.version,
      chunks: sharedConfig.chunks ?? chunks,
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

  result = Object.keys(result)
    .filter(key => !isInSkipList(key, skip))
    .reduce((acc, cur) => ({ ...acc, [cur]: result[cur] }), {});

  return result;
}

function removeSkippedMappings(config: FederationConfig, skipList: PreparedSkipList): PathToImport {
  const rootTsConfigPath = findRootTsConfigJson();

  const paths = getRawMappedPaths(rootTsConfigPath, config.sharedMappings);

  return Object.entries(paths)
    .filter(([, _import]) => !isInSkipList(_import, skipList))
    .reduce((acc, [_path, _import]) => ({ ...acc, [_path]: _import }), {} as PathToImport);
}
