import { getRawMappedPaths } from './mapped-paths.js';
import { fromPackageJson } from './share-utils.js';
import { findMappingsTsConfig } from './project-paths.js';
import type {
  ExposeEntry,
  FederationConfig,
  MappingConfigInput,
  NormalizedFederationConfig,
  NormalizedSharedMappingConfigs,
  SharedMappingConfigs,
} from '../domain/config/federation-config.contract.js';
import { isInSkipList, prepareSkipList } from './default-skip-list.js';
import { normalizeMappingConfig, withoutSkippedMappings } from './mapping-utils.js';
import { type PreparedSkipList } from '../domain/config/skip-list.contract.js';
import type { ConfigBuilder } from '../domain/config/config-builders.contract.js';
import type {
  NormalizedExternalConfig,
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from '../domain/config/external-config.contract.js';
import { logger } from '../utils/logger.js';
import { formatList } from '../utils/format-list.js';

const MAX_LISTED = 5;

export function withNativeFederation(config: FederationConfig): NormalizedFederationConfig {
  const skip = prepareSkipList(config.skip ?? []);

  const chunks = config.chunks ?? true;
  const mappingVersion = config.features?.mappingVersion ?? true;
  const denseExternals = config.features?.denseExternals ?? false;

  const { paths, configs } = getRawMappedPaths(
    findMappingsTsConfig(),
    fromBuilder(config.sharedMappings)
  );

  const normalized: NormalizedFederationConfig = {
    $type: 'classic',
    name: config.name ?? '',
    exposes: normalizeExposes(config.exposes),
    shared: normalizeShared(config, skip, chunks),
    sharedMappings: withoutSkippedMappings(paths, skip),
    sharedMappingsConfig: normalizeMappingConfigs(configs, mappingVersion, denseExternals),
    chunks,
    skip,
    externals: config.externals ?? [],
    features: {
      mappingVersion,
      ignoreUnusedDeps: config.features?.ignoreUnusedDeps ?? true,
      denseChunking: config.features?.denseChunking ?? false,
      denseExternals,
      integrityHashes: config.features?.integrityHashes ?? false,
      synthesizeCjsExports: config.features?.synthesizeCjsExports ?? true,
      strictImports: config.features?.strictImports ?? false,
    },
    ...(config.shareScope && { shareScope: config.shareScope }),
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

  result = Object.keys(shared).reduce<NormalizedSharedExternalsConfig>((acc, cur) => {
    const key = cur.replace(/\\/g, '/');
    const sharedConfig = shared[cur]!;

    if ((sharedConfig as MappingConfigInput).package !== undefined) {
      throw new Error(
        `Shared external '${cur}' sets 'package'. An npm package is already named by its package.json; use 'package' only on sharedMappings.`
      );
    }

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

const IGNORED_MAPPING_PROPS = ['platform', 'chunks', 'packageInfo'] as const;

function normalizeMappingConfigs(
  configs: SharedMappingConfigs,
  mappingVersion: boolean,
  denseExternals: boolean
): NormalizedSharedMappingConfigs {
  const normalized = Object.entries(configs).reduce((acc, [pattern, cfg]) => {
    const ignored = IGNORED_MAPPING_PROPS.filter(prop => cfg[prop] !== undefined);
    if (ignored.length > 0) {
      logger.warn(
        `Mapping '${pattern}' sets ${ignored.join(', ')}, which mapped paths do not honour. Ignored.`
      );
    }
    assertPackageDeclaration(pattern, cfg);

    acc[pattern] = normalizeMappingConfig(
      denseExternals ? cfg : { ...cfg, package: undefined },
      mappingVersion
    );
    return acc;
  }, {} as NormalizedSharedMappingConfigs);

  const declaring = Object.keys(configs).filter(pattern => configs[pattern]!.package !== undefined);
  if (declaring.length > 0 && !denseExternals) {
    logger.warn(
      `Mappings ${formatList(declaring, MAX_LISTED)} declare a 'package', which only takes effect with features.denseExternals. Ignored.`
    );
  }
  return normalized;
}

// Rules and rationale: AGENTS.md, `package` (core#198).
function assertPackageDeclaration(pattern: string, cfg: MappingConfigInput): void {
  const declared = cfg.package;
  if (declared === undefined) return;

  if (declared !== true && (typeof declared !== 'string' || declared === '')) {
    throw new Error(
      `Mapping '${pattern}' sets 'package' to ${JSON.stringify(declared)}; use true or a package name.`
    );
  }
  if (cfg.build) {
    throw new Error(
      `Mapping '${pattern}' sets both 'package' and 'build: ${cfg.build}'. A declared package picks its own bundle: remove 'build' (a mappingsFromWorkspace() patch inherits 'package' from its base config; set it to undefined there).`
    );
  }
  if (declared === true) return;

  const literalPrefix = pattern.includes('*')
    ? pattern.slice(0, pattern.indexOf('*'))
    : pattern + '/';
  const tooShallow = declared.startsWith('@') && !declared.includes('/');
  if (tooShallow || !literalPrefix.startsWith(declared + '/')) {
    throw new Error(
      `Mapping '${pattern}' declares package '${declared}', which must be a '/'-aligned prefix of every mapping it covers and at least '@scope/name' deep.`
    );
  }
}
