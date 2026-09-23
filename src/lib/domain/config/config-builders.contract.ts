import type {
  ExternalConfig,
  ExternalConfigInput,
  ResolvedSharedExternalsConfig,
  ShareExternalsOptions,
} from './external-config.contract.js';
import type { SharedMappingEntry } from './federation-config.contract.js';
import type { SkipList } from './skip-list.contract.js';

// `withNativeFederation` accepts a builder wherever it accepts the value `get()` returns.
export interface ConfigBuilder<T> {
  get(): T;
}

export interface PackageJsonExternalsBuilder extends ConfigBuilder<ResolvedSharedExternalsConfig> {
  filter(patterns: string[]): PackageJsonExternalsBuilder;
  skip(externals: SkipList): PackageJsonExternalsBuilder;
  override(externals: ShareExternalsOptions): PackageJsonExternalsBuilder;
  patch(externals: string[], cfg: Partial<ExternalConfig>): PackageJsonExternalsBuilder;
}

export interface WorkspaceMappingsBuilder extends ConfigBuilder<SharedMappingEntry[]> {
  filter(patterns: string[]): WorkspaceMappingsBuilder;
  patch(patterns: string[], cfg: Partial<ExternalConfigInput>): WorkspaceMappingsBuilder;
}
