import type { MappedPath } from '../utils/mapped-path.contract.js';

export type NFBuildAdapter = (options: NFBuildAdapterOptions) => Promise<NFBuildAdapterResult[]>;

export type BuildKind = 'shared-package' | 'shared-mapping' | 'exposed' | 'mapping-or-exposed';

export interface EntryPoint {
  fileName: string;
  outName: string;
  key?: string;
}

export interface NFBuildAdapterOptions {
  entryPoints: EntryPoint[];
  tsConfigPath?: string;
  external: Array<string>;
  outdir: string;
  mappedPaths: MappedPath[];
  packageName?: string;
  esm?: boolean;
  dev?: boolean;
  watch?: boolean;
  chunks?: boolean;
  kind: BuildKind;
  hash: boolean;
  platform?: 'browser' | 'node';
  optimizedMappings?: boolean;
  signal?: AbortSignal;
}

export interface NFBuildAdapterResult {
  fileName: string;
}
