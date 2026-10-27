import type { PreparedSkipList, SkipList } from './skip-list.contract.js';
import type { PathToImport } from '../utils/mapped-path.contract.js';
import type {
  AutoRequiredOptions,
  ExternalConfigInput,
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from './external-config.contract.js';
import type { ConfigBuilder } from './config-builders.contract.js';

export type ExposeEntry = { file: string; element?: string };

export type MappingConfigInput = Omit<ExternalConfigInput, 'build'> & {
  build?: 'separate' | 'package';
};

// Declares a package by prefix, see `mappingsFromWorkspace().package()`. It selects nothing.
export type SharedMappingPackageEntry = Omit<MappingConfigInput, 'build'> & { package: string };

export type SharedMappingEntry =
  | string
  | [string[], MappingConfigInput]
  | SharedMappingPackageEntry;

/** Selection pattern -> config, kept in declaration order: first match wins. */
export type SharedMappingConfigs = Record<string, MappingConfigInput>;

/**
 * Only the subset of `ExternalConfig` a mapping can act on — `build` picks a bundle of its own,
 * but `platform`/`chunks`/`packageInfo` have nothing to select. `requiredVersion` and `version` stay optional because their
 * defaults are read from the mapped lib's package.json at build time, which is also why an
 * `AutoRequiredOptions` reaches this far unresolved.
 *
 * `includeSecondaries` collapses to a boolean meaning "exempt from `ignoreUnusedDeps`
 * pruning" — stronger than on a shared external, where it only exempts the secondaries.
 * `resolveGlob` is lifted out of it because a mapping has no secondaries to apply it to.
 */
export interface NormalizedMappingConfig {
  singleton: boolean;
  strictVersion: boolean;
  build?: 'separate' | 'package';
  requiredVersion?: string | AutoRequiredOptions;
  version?: string;
  shareScope?: string;
  pool?: string;
  includeSecondaries?: boolean;
  resolveGlob?: boolean;
}

export type NormalizedSharedMappingConfigs = Record<string, NormalizedMappingConfig>;

// A prefix covers itself and its subpaths, and its config outranks every sharedMappingsConfig pattern.
export type NormalizedSharedMappingPackages = Record<string, NormalizedMappingConfig>;

export interface FederationConfig {
  name?: string;
  exposes?: Record<string, string | ExposeEntry>;
  shared?: SharedExternalsConfig | ConfigBuilder<SharedExternalsConfig>;
  platform?: 'browser' | 'node';
  sharedMappings?: Array<SharedMappingEntry> | ConfigBuilder<Array<SharedMappingEntry>>;
  chunks?: boolean;
  skip?: SkipList;
  externals?: string[];
  shareScope?: string;
  features?: {
    mappingVersion?: boolean;
    ignoreUnusedDeps?: boolean;
    denseChunking?: boolean;
    denseExternals?: boolean;
    integrityHashes?: boolean;
    synthesizeCjsExports?: boolean;
    strictImports?: boolean;
  };
}

export interface NormalizedFederationConfig {
  $type: 'classic';
  name: string;
  exposes: Record<string, ExposeEntry>;
  shared: NormalizedSharedExternalsConfig;
  /** In v5 each entry also carries its resolved package and config, replacing the two fields below. */
  sharedMappings: PathToImport;
  /** Removed in v5: read the config from the `sharedMappings` entry. */
  sharedMappingsConfig: NormalizedSharedMappingConfigs;
  /** Removed in v5: read the package from the `sharedMappings` entry. */
  sharedMappingPackages?: NormalizedSharedMappingPackages;
  skip: PreparedSkipList;
  chunks: boolean;
  externals: string[];
  shareScope?: string;
  features: {
    mappingVersion: boolean;
    ignoreUnusedDeps: boolean;
    denseChunking: boolean;
    denseExternals: boolean;
    integrityHashes: boolean;
    synthesizeCjsExports: boolean;
    strictImports: boolean;
  };
}
