import type {
  ExternalConfig,
  ResolvedSharedExternalsConfig,
  ShareExternalsOptions,
} from './external-config.contract.js';
import type { MappingConfigInput, SharedMappingEntry } from './federation-config.contract.js';
import type { SkipList } from './skip-list.contract.js';

// `withNativeFederation` accepts a builder wherever it accepts the value `get()` returns.
export interface ConfigBuilder<T> {
  get(): T;
}

export interface PackageJsonExternalsBuilder extends ConfigBuilder<ResolvedSharedExternalsConfig> {
  /** @deprecated Not needed: pass the builder itself; extra keys go in `.override()`. */
  get(): ResolvedSharedExternalsConfig;
  only(patterns: string[]): PackageJsonExternalsBuilder;
  filter(patterns: string[]): PackageJsonExternalsBuilder;
  skip(externals: SkipList): PackageJsonExternalsBuilder;
  override(externals: ShareExternalsOptions): PackageJsonExternalsBuilder;
  patch(patterns: string[], cfg: Partial<ExternalConfig>): PackageJsonExternalsBuilder;
}

export interface WorkspaceMappingsBuilder extends ConfigBuilder<SharedMappingEntry[]> {
  only(patterns: string[]): WorkspaceMappingsBuilder;
  filter(patterns: string[]): WorkspaceMappingsBuilder;
  patch(patterns: string[], cfg: Partial<MappingConfigInput>): WorkspaceMappingsBuilder;
  package(prefix: string, cfg?: Omit<MappingConfigInput, 'build'>): WorkspaceMappingsBuilder;
}
