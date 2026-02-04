export interface FederationInfo {
  name: string;
  exposes: ExposesInfo[];
  shared: SharedInfo[];
  chunks?: Record<string, string[]>;
  buildNotificationsEndpoint?: string;
}
export type SharedInfo = {
  singleton: boolean;
  strictVersion: boolean;
  requiredVersion: string;
  version?: string;
  packageName: string;
  shareScope?: string;
  bundle?: string;
  outFileName: string;
  dev?: {
    entryPoint: string;
  };
};

export type ChunkInfo = Record<string, string[]>;

export interface ExposesInfo {
  key: string;
  outFileName: string;
  dev?: {
    entryPoint: string;
  };
}

export interface ArtifactInfo {
  mappings: SharedInfo[];
  exposes: ExposesInfo[];
}
