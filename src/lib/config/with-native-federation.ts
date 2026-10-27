import { getRawMappedPaths } from './mapped-paths.js';
import { fromPackageJson } from './share-utils.js';
import { findMappingsTsConfig } from './project-paths.js';
import type {
  ExposeEntry,
  FederationConfig,
  NormalizedFederationConfig,
  NormalizedSharedMappingConfigs,
  SharedMappingConfigs,
} from '../domain/config/federation-config.contract.js';
import { isInSkipList, prepareSkipList } from './default-skip-list.js';
import { normalizeMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import {
  assertMappingPackagePrefixes,
  assertNoConfigUnderMappingPackage,
  warnUnmatchedMappingPackages,
} from './validate-mappings.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';
import type { ConfigBuilder } from '../domain/config/config-builders.contract.js';
import type {
  NormalizedExternalConfig,
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from '../domain/config/external-config.contract.js';
import { logger } from '../utils/logger.js';
import { inferPackageFromSecondary } from '../utils/normalize.js';

export function withNativeFederation(config: FederationConfig): NormalizedFederationConfig {
  const skip = prepareSkipList(config.skip ?? []);

  const chunks = config.chunks ?? true;
  const mappingVersion = config.features?.mappingVersion ?? true;

  const { paths, configs, keys, packages } = getRawMappedPaths(
    findMappingsTsConfig(),
    fromBuilder(config.sharedMappings)
  );
  const prefixes = Object.keys(packages);
  assertMappingPackagePrefixes(prefixes);
  assertNoConfigUnderMappingPackage(
    Object.keys(configs).filter(pattern => Object.keys(configs[pattern]!).length > 0),
    prefixes
  );
  warnUnmatchedMappingPackages(prefixes, keys);

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
      strictImports: config.features?.strictImports ?? false,
    },
    ...(config.shareScope && { shareScope: config.shareScope }),
    ...(prefixes.length > 0 && {
      sharedMappingPackages: normalizeMappingConfigs(packages, mappingVersion),
    }),
  };

  return normalized;
}

// A shared config may legitimately contain a package named `get`, but its value is an object.
function fromBuilder<T>(value: T | ConfigBuilder<T> | undefined): T | undefined {
  return typeof (value as ConfigBuilder<T> | undefined)?.get === 'function'
    ? (value as ConfigBuilder<T>).get()
    : (value as T | undefined);
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
    fromBuilder<SharedExternalsConfig>(config.shared) ??
    (fromPackageJson({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      platform: 'browser',
    }).get() as NormalizedSharedExternalsConfig);

  const ignoredChunks: string[] = [];

  result = Object.keys(shared).reduce<NormalizedSharedExternalsConfig>((acc, cur) => {
    const key = cur.replace(/\\/g, '/');
    const sharedConfig = shared[cur]!;

    // Without a bundle of its own, an external is built with the global `chunks`.
    if (
      !sharedConfig.build &&
      sharedConfig.chunks !== undefined &&
      sharedConfig.chunks !== chunks
    ) {
      ignoredChunks.push(key);
    }

    const normalizedConfig: NormalizedExternalConfig = {
      requiredVersion: sharedConfig.requiredVersion ?? 'auto',
      singleton: sharedConfig.singleton ?? false,
      strictVersion: sharedConfig.strictVersion ?? false,
      version: sharedConfig.version,
      ...(sharedConfig.build &&
        sharedConfig.chunks !== undefined && { chunks: sharedConfig.chunks }),
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

  warnIgnoredChunks(
    ignoredChunks.filter(key => key in result),
    chunks
  );

  return result;
}

// Secondaries inherit their package's config, so one setting is reported once per package.
function warnIgnoredChunks(keys: string[], chunks: boolean): void {
  if (keys.length === 0) return;
  const packages = [...new Set(keys.map(inferPackageFromSecondary))];
  logger.warn(
    `Shared externals ${packages.map(p => `'${p}'`).join(', ')} set chunks: ${!chunks}, but ` +
      `without build they are built in the shared bundle, which uses the global chunks: ` +
      `${chunks}. Remove chunks, or give the external a bundle of its own with build: ` +
      `'separate' or 'package'.`
  );
}

const MAPPING_BUILDS = new Set([undefined, 'separate', 'package']);

function normalizeMappingConfigs(
  configs: SharedMappingConfigs,
  mappingVersion: boolean
): NormalizedSharedMappingConfigs {
  return Object.entries(configs).reduce((acc, [pattern, cfg]) => {
    if (!MAPPING_BUILDS.has(cfg.build)) {
      throw new Error(
        `Mapping '${pattern}' sets build: '${cfg.build}'; a mapping takes 'separate' or 'package'. ` +
          `To bundle and publish a library's entry points as one package, declare it with ` +
          `mappingsFromWorkspace().package('<library>').`
      );
    }

    acc[pattern] = normalizeMappingConfig(cfg, mappingVersion);
    return acc;
  }, Object.create(null) as NormalizedSharedMappingConfigs);
}
