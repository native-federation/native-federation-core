import type { PathToImport } from '../utils/mapped-path.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface NFBuildAdapterContext<TBundlerContext = unknown> {
  ctx: TBundlerContext;
  outdir: string;
  dev: boolean;
  name: string;
  isMappingOrExposed: boolean;
}

export interface ExternalsCacheKey {
  adapter: string;
  options?: Record<string, string | number | boolean>;
}

export interface NFBuildAdapter {
  // Read before setup(), so it must be known when the adapter is created (core#152).
  readonly externalsCacheKey?: ExternalsCacheKey;

  // Specifiers the adapter's own output imports and something at runtime provides (a dev client,
  // a polyfill), handled exactly like `config.externals`, which they are merged into. Core never
  // reads them from the adapter: pass them to normalizeFederationOptions in `NFAdapterInput`
  // (federationBuilder.init does). Keep them exact or scoped: a broad `*` would also leave real
  // dependencies unbundled in the shared bundles.
  readonly externals?: readonly string[];

  setup(name: string, options: NFBuildAdapterOptions): Promise<void>;

  // Every file written for the bundle, on a rebuild too, not only the changed ones. Files go flat
  // into `outdir` and `fileName` is their absolute path: core lists and hashes them by base name.
  build(
    name: string,
    opts?: {
      modifiedFiles?: string[];
      signal?: AbortSignal;
    }
  ): Promise<NFBuildAdapterResult[]>;

  dispose(name?: string): Promise<void>;
}

export interface EntryPoint {
  fileName: string;
  outName: string;
  key?: string;
}

export interface NFBuildAdapterOptions<TBundlerCache = unknown> {
  entryPoints: EntryPoint[];
  // Unresolved; a relative path is workspace-relative, not cwd-relative.
  tsConfigPath?: string;
  // Read as matchesExternal does; every match must stay the bare specifier, never a resolved path.
  external: string[];
  outdir: string;
  mappedPaths: PathToImport;
  isMappingOrExposed: boolean;
  dev?: boolean;
  watch?: boolean;
  chunks?: boolean;
  hash: boolean;
  platform?: 'browser' | 'node';
  optimizedMappings?: boolean;
  cache: FederationCache<TBundlerCache>;
}

export interface NFBuildAdapterResult {
  fileName: string;
}

// What an adapter hands normalizeFederationOptions besides the build options. In v5 it also
// takes the cache, which is the second argument until then.
export interface NFAdapterInput {
  externals?: readonly string[];
}
