import type { PreparedSkipList, SkipList } from './skip-list.contract.js';
import type { PathToImport } from '../utils/mapped-path.contract.js';
import type {
  ExternalConfig,
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from './external-config.contract.js';

export type ExposeEntry = { file: string; element?: string };

export type SharedMappingEntry = string | [string[], ExternalConfig];

/** Selection pattern -> config, kept in declaration order: first match wins. */
export type SharedMappingConfigs = Record<string, ExternalConfig>;

export interface FederationConfig {
  name?: string;
  exposes?: Record<string, string | ExposeEntry>;
  shared?: SharedExternalsConfig;
  platform?: 'browser' | 'node';
  sharedMappings?: Array<SharedMappingEntry>;
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
