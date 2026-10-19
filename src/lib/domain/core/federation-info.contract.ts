export interface FederationInfo {
  $version?: string;
  name: string;
  exposes: ExposesInfo[];
  shared: Array<SharedInfo | DenseSharedInfo>;
  chunks?: Record<string, string[]>;
  integrity?: IntegrityMap;
  buildNotificationsEndpoint?: string;
}

export type DenseSharedInfo = Omit<SharedInfo, 'outFileName'> & { entries: Record<string, string> };

export type SharedInfo = {
  singleton: boolean;
  strictVersion: boolean;
  requiredVersion: string;
  version?: string;
  packageName: string;
  shareScope?: string;
  pool?: string;
  bundle?: string;
  outFileName: string;
  dev?: {
    entryPoint: string;
  };
};

export type ChunkInfo = Record<string, string[]>;

export type IntegrityMap = Record<string, string>;

// A file the build wrote into the output folder: scripts, their source maps and any other asset.
// Never published. `fileName` is the base name, since adapters write flat into outdir.
export interface OutputFile {
  fileName: string;
  platform: 'browser' | 'node';
}

export interface ExposesInfo {
  key: string;
  outFileName: string;
  element?: string;
  dev?: {
    entryPoint: string;
  };
}

// Not exported from ./domain: only bundleShared returns it.
export interface SharedBundleResult {
  externals: SharedInfo[];
  chunks?: ChunkInfo;
  integrity?: IntegrityMap;
  outputFiles: OutputFile[];
}

export interface ArtifactInfo {
  mappings: SharedInfo[];
  exposes: ExposesInfo[];
  chunks?: ChunkInfo;
  integrity?: IntegrityMap;
  outputFiles?: OutputFile[];
}
