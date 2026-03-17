import type { MappedPath } from '../utils/mapped-path.contract.js';
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

export interface EntryPoint {
  fileName: string;
  outName: string;
  key?: string;
}

export interface NFBuildAdapterOptions<TBundlerCache = unknown> {
  entryPoints: EntryPoint[];
  tsConfigPath?: string;
  external: string[];
  outdir: string;
  mappedPaths: MappedPath[];
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
