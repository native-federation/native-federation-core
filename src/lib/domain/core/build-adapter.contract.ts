import type { PathToImport } from '../utils/mapped-path.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface NFBuildAdapterContext<TBundlerContext = unknown> {
  ctx: TBundlerContext;
  outdir: string;
  dev: boolean;
  name: string;
  /** @deprecated Core never reads this context; it moves to the adapters in v5. */
  isMappingOrExposed: boolean;
}

export interface ExternalsCacheKey {
  adapter: string;
  options?: Record<string, string | number | boolean>;
}

export interface NFBuildAdapter {
  // Read before setup(), so it must be known when the adapter is created (core#152).
  readonly externalsCacheKey?: ExternalsCacheKey;

  // Imports the adapter injects itself (a dev client, a polyfill). Core never reads this field:
  // pass it to normalizeFederationOptions in `NFAdapterInput`. Keep entries exact or scoped.
  readonly externals?: readonly string[];

  // Replaces a context already set up under `name`. Bundles under different names may be set up
  // and built concurrently.
  setup(name: string, options: NFBuildAdapterOptions): Promise<void>;

  // Every file written for the bundle, on a rebuild too, not only the changed ones. Files go flat
  // into `outdir` and `fileName` is their absolute path: core lists and hashes them by base name.
  // Core rewrites `./x` to `@nf-internal/x` only when `x` is a non-entry script listed here.
  // Every listed file is on disk with this build's bytes when the promise resolves: core renames
  // and deletes them next. A watch rebuild of a mapping or exposed bundle calls build without setup.
  build(
    name: string,
    opts?: {
      // Authoritative: hand it to the bundler, whose own change detection may see nothing.
      modifiedFiles?: string[];
      signal?: AbortSignal;
    }
  ): Promise<NFBuildAdapterResult[]>;

  dispose(name?: string): Promise<void>;

  // Shared bundles only: small JSON data about the build of `name` (package names, not paths: the
  // cache may be restored elsewhere), read after build, before dispose. Core stores it with the
  // cache entry and serves it, on a hit too, as `FederationCache.adapterData[name]` once the shared
  // run completes; treat the names as opaque. A hit serves what was stored, so collect it whatever
  // the options, or put the option that decides it in `externalsCacheKey`.
  cacheData?(name: string): unknown | Promise<unknown>;
}

export interface EntryPoint {
  fileName: string;
  // A flat file name, unique within the bundle: emit it as given, or as `<name>-<hash><ext>` when
  // hashed.
  outName: string;
  key?: string;
}

export type NFBundleKind = 'shared' | 'mapping' | 'exposed';

export interface NFBuildAdapterOptions<TBundlerCache = unknown> {
  // Keep the order: it decides how shared code is split into chunks.
  entryPoints: EntryPoint[];
  // Unresolved; a relative path is workspace-relative, not cwd-relative.
  tsConfigPath?: string;
  // Read as matchesExternal does, relative imports too; a match stays as written, never resolved.
  external: string[];
  outdir: string;
  mappedPaths: PathToImport;
  kind: NFBundleKind;
  /** @deprecated Read `kind`; mappings and exposed modules are built in separate bundles. */
  isMappingOrExposed: boolean;
  dev?: boolean;
  watch?: boolean;
  chunks?: boolean;
  hash: boolean;
  platform?: 'browser' | 'node';
  /** @deprecated Unused by core and by the published adapters; removed in v5. */
  optimizedMappings?: boolean;
  cache: FederationCache<TBundlerCache>;
}

export interface NFBuildAdapterResult {
  fileName: string;
  // The EntryPoint.outName this file was built from, verbatim, on the entry's own script only. Once
  // any result sets it, core stops matching entries by file name.
  entry?: string;
}

export interface NFAdapterInput {
  externals?: readonly string[];
}
