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

export type SharedMappingEntry = string | [string[], ExternalConfigInput];

/** Selection pattern -> config, kept in declaration order: first match wins. */
export type SharedMappingConfigs = Record<string, ExternalConfigInput>;

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
  };
}

export interface NormalizedFederationConfig {
  $type: 'classic';
  name: string;
  exposes: Record<string, ExposeEntry>;
  shared: NormalizedSharedExternalsConfig;
  sharedMappings: PathToImport;
  sharedMappingsConfig: NormalizedSharedMappingConfigs;
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
  };
}
