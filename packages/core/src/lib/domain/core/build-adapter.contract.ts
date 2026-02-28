import type { MappedPath } from '../utils/mapped-path.contract.js';
import type { FederationCache } from './federation-cache.contract.js';

export interface NFBuildAdapter {
  setup(options: NFBuildAdapterOptions): Promise<void>;

  build(
    name: string,
    opts?: {
      files?: string[];
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
  bundleName: string;
  isNodeModules: boolean;
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
