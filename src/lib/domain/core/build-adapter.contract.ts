import type { PathToImport } from '../utils/mapped-path.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface NFBuildAdapterContext<TBundlerContext = unknown> {
  ctx: TBundlerContext;
  outdir: string;
  dev: boolean;
  name: string;
  isMappingOrExposed: boolean;
}

export interface NFBuildAdapter {
  setup(name: string, options: NFBuildAdapterOptions): Promise<void>;

  build(
    name: string,
    opts?: {
      modifiedFiles?: string[];
      signal?: AbortSignal;
    }
  ): Promise<NFBuildAdapterResult[]>;

  dispose(name?: string): Promise<void>;
}

/**
 * Whether an entry point still has to be compiled.
 *
 * `'source'` is workspace source the adapter's own toolchain owns — exposes, and mappings onto a
 * barrel. `'package'` is an already-built artifact with a manifest: a shared npm dependency, or a
 * mapping onto a library's build output. An adapter that stands up a compiler (ngtsc) must keep
 * `'package'` entries out of it; they are bundled, never compiled.
 *
 * Core decides this — an adapter cannot, and inferring it from the file extension is a guess.
 */
export type EntryPointKind = 'source' | 'package';

export interface EntryPoint {
  fileName: string;
  outName: string;
  key?: string;
  kind: EntryPointKind;
}

export interface NFBuildAdapterOptions<TBundlerCache = unknown> {
  entryPoints: EntryPoint[];
  tsConfigPath?: string;
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
