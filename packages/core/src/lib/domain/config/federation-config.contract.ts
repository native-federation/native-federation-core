import type { PreparedSkipList, SkipList } from './skip-list.contract.js';
import type { PathToImport } from '../utils/mapped-path.contract.js';
import type {
  NormalizedSharedExternalsConfig,
  SharedExternalsConfig,
} from './external-config.contract.js';

export interface FederationConfig {
  name?: string;
  exposes?: Record<string, string>;
  shared?: SharedExternalsConfig;
  platform?: 'browser' | 'node';
  sharedMappings?: Array<string>;
  skip?: SkipList;
  externals?: string[];
  shareScope?: string;
  features?: {
    mappingVersion?: boolean;
    ignoreUnusedDeps?: boolean;
  };
}

export interface NormalizedFederationConfig {
  $type: 'classic';
  name: string;
  exposes: Record<string, string>;
  shared: NormalizedSharedExternalsConfig;
  sharedMappings: PathToImport;
  skip: PreparedSkipList;
  externals: string[];
  shareScope?: string;
  features: {
    mappingVersion: boolean;
    ignoreUnusedDeps: boolean;
  };
}
