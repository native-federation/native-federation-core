import type { MappedPath } from '../utils/mapped-path.contract.js';

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

// export type BuildKind = 'shared-package' | 'shared-mapping' | 'exposed' | 'mapping-or-exposed';

export interface EntryPoint {
  fileName: string;
  outName: string;
  key?: string;
}

export interface NFBuildAdapterOptions {
  entryPoints: EntryPoint[];
  tsConfigPath?: string;
  external: string[];
  outdir: string;
  mappedPaths: MappedPath[];
  // packageName?: string;
  // esm?: boolean;
  bundleName: string;
  isNodeModules: boolean;
  dev?: boolean;
  watch?: boolean;
  chunks?: boolean;
  cachePath?: string;
  hash: boolean;
  platform?: 'browser' | 'node';
  optimizedMappings?: boolean;
}

export interface NFBuildAdapterResult {
  fileName: string;
}
