import { getRawMappedPaths } from './mapped-paths.js';
import { fromPackageJson } from './share-utils.js';
import { findRootTsConfigJson } from './project-paths.js';
import type {
  ExposeEntry,
  FederationConfig,
  NormalizedFederationConfig,
  NormalizedSharedMappingConfigs,
  SharedMappingConfigs,
} from '../domain/config/federation-config.contract.js';
import { isInSkipList, prepareSkipList } from './default-skip-list.js';
import { withoutSkippedMappings } from './mapping-utils.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';
import type {
  NormalizedExternalConfig,
  NormalizedSharedExternalsConfig,
} from '../domain/config/external-config.contract.js';
import { logger } from '../utils/logger.js';

export function withNativeFederation(config: FederationConfig): NormalizedFederationConfig {
  const skip = prepareSkipList(config.skip ?? []);

  const chunks = config.chunks ?? true;
  const mappingVersion = config.features?.mappingVersion ?? true;

  const { paths, configs } = getRawMappedPaths(findRootTsConfigJson(), config.sharedMappings);

  const normalized: NormalizedFederationConfig = {
    $type: 'classic',
    name: config.name ?? '',
    exposes: normalizeExposes(config.exposes),
    shared: normalizeShared(config, skip, chunks),
    sharedMappings: withoutSkippedMappings(paths, skip),
    sharedMappingsConfig: normalizeMappingConfigs(configs, mappingVersion),
    chunks,
    skip,
    externals: config.externals ?? [],
    features: {
      mappingVersion,
      ignoreUnusedDeps: config.features?.ignoreUnusedDeps ?? true,
      denseChunking: config.features?.denseChunking ?? false,
      denseExternals: config.features?.denseExternals ?? false,
      integrityHashes: config.features?.integrityHashes ?? false,
      synthesizeCjsExports: config.features?.synthesizeCjsExports ?? true,
    },
    ...(config.shareScope && { shareScope: config.shareScope }),
  };

  return normalized;
}

function normalizeExposes(exposes: FederationConfig['exposes']): Record<string, ExposeEntry> {
  if (!exposes) return {};
  return Object.fromEntries(
    Object.entries(exposes).map(([key, value]) => [
      key,
      typeof value === 'string' ? { file: value } : value,
    ])
  );
}

function normalizeShared(
  config: FederationConfig,
  skip: PreparedSkipList,
  chunks: boolean
): NormalizedSharedExternalsConfig {
  let result: NormalizedSharedExternalsConfig = {};

  const shared =
    config.shared ??
    (fromPackageJson({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      platform: 'browser',
    }).get() as NormalizedSharedExternalsConfig);

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
      includeSecondaries:
        typeof sharedConfig.includeSecondaries === 'object'
          ? !!sharedConfig.includeSecondaries.keepAll
          : sharedConfig.includeSecondaries,
      packageInfo: sharedConfig.packageInfo as NormalizedExternalConfig['packageInfo'],
      platform: sharedConfig.platform ?? config.platform ?? 'browser',
      build: sharedConfig.build ?? 'default',
      ...(sharedConfig.shareScope && { shareScope: sharedConfig.shareScope }),
      ...(sharedConfig.pool && { pool: sharedConfig.pool }),
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

// Only singleton/strictVersion can be settled here; requiredVersion and version are read
// from the mapped lib's package.json at build time, so they stay undefined when unset.
function normalizeMappingConfigs(
  configs: SharedMappingConfigs,
  mappingVersion: boolean
): NormalizedSharedMappingConfigs {
  return Object.entries(configs).reduce((acc, [pattern, cfg]) => {
    acc[pattern] = {
      singleton: cfg.singleton ?? true,
      strictVersion: cfg.strictVersion ?? mappingVersion,
      ...(cfg.requiredVersion !== undefined && { requiredVersion: cfg.requiredVersion }),
      ...(cfg.version !== undefined && { version: cfg.version }),
      ...(cfg.shareScope && { shareScope: cfg.shareScope }),
      ...(cfg.pool && { pool: cfg.pool }),
      ...(cfg.includeSecondaries !== undefined && {
        includeSecondaries: cfg.includeSecondaries,
      }),
    };
    return acc;
  }, {} as NormalizedSharedMappingConfigs);
}
