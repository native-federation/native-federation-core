import type { PreparedSkipList, SkipList } from '../core/default-skip-list.js';
import type { MappedPath } from '../utils/mapped-paths.js';
import type {
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from './external-config.contract.js';

export interface FederationConfig {
  name?: string;
  exposes?: Record<string, string>;
  shared?: SharedExternalsConfig;
  sharedMappings?: Array<string>;
  skip?: SkipList;
  externals?: string[];
  features?: {
    mappingVersion?: boolean;
    ignoreUnusedDeps?: boolean;
  };
}

export interface NormalizedFederationConfig {
  name: string;
  exposes: Record<string, string>;
  shared: NormalizedSharedExternalsConfig;
  sharedMappings: Array<MappedPath>;
  skip: PreparedSkipList;
  externals: string[];
  features: {
    mappingVersion: boolean;
    ignoreUnusedDeps: boolean;
  };
}
